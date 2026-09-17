// @vitest-environment jsdom

import type {
  AiAssetSummary,
  AiModelSummary,
  AiTaskSummary,
  AuthUser,
  ImageGenerationResponse,
  PublicSiteSettings
} from "@ai-aggregate/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "../../../lib/i18n/types";
import { authTokenKey, authUserKey } from "../../../components/auth-state";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import {
  useWorkspaceShellContext,
  WorkspaceShellProvider
} from "../../../components/workspace/workspace-shell-context";
import {
  deriveImageResultVersions,
  deriveImageResultBatches,
  compressReferenceImage,
  dismissedImageSessionsStorageKey,
  clampImageScrollTop,
  getImagePromptDraftStorageKey,
  getImageScrollStorageKey,
  getImageSessionsStorageKey,
  getDismissedImageSessionsStorageKey,
  ImagePageContent,
  imagePromptDraftStorageKey,
  imageScrollStorageKey,
  imageSessionsStorageKey,
  imageReferencePreparationTimeoutMs,
  backendImageHistoryReloadDebounceMs,
  getImagePromptCardAspectCategory,
  imageInspirationPresets,
  parseImageCreationMode,
  parseStoredImageSessions,
  resolveImageGenerationSize,
  resolveImageSelectableModel,
  resolveModelMaxReferenceImages,
  moveSelectedReferenceImage,
  resolveImageEntryDisplayState,
  resolveSelectedImageResultVersion,
  readImagePromptDraft,
  readImageScrollTop,
  shouldSubmitImagePromptOnEnter,
  trimImageStreamEntries,
  serializeDismissedImageSessionIds,
  serializeImageSessionsForStorage,
  shouldClearImagePromptDraftAfterSubmit,
  taskToImageStreamEntry,
  writeImagePromptDraft,
  writeImageScrollTop,
  type ImageStreamEntry
} from "./image-page-content";
import { findImageTaskForFailedFetchReconcile } from "../../../lib/image-generation-reconciliation";
import {
  clearImageCreationHandoff,
  getImageCreationHandoffStorageKey,
  imageCreationHandoffTtlMs,
  parseImageCreationHandoff,
  readImageCreationHandoff,
  writeImageCreationHandoff
} from "../../image-creation-handoff";

const imagePageSourcePath = resolve(
  process.cwd(),
  "app/(workspace)/image/image-page-content.tsx"
);
const imagePageSource = readFileSync(imagePageSourcePath, "utf8");
const creationWorkspaceSource = readFileSync(
  resolve(process.cwd(), "app/(workspace)/image/creation-workspace-view.tsx"),
  "utf8"
);
const referenceCompressionDataUrl =
  "data:image/jpeg;base64,Y29udGludWF0aW9u";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function imageModel(overrides: Partial<AiModelSummary> = {}) {
  return {
    id: "model_image",
    name: "Image Model",
    displayName: "Image Model",
    slug: "image-model",
    provider: "OPENAI_COMPATIBLE" as const,
    modelId: "image-model",
    enabled: true,
    creditCost: 2,
    allowGuest: false,
    sortOrder: 0,
    group: "image",
    tags: ["image"],
    capability: "image" as const,
    isRecommended: false,
    ...overrides,
    maxReferenceImages: overrides.maxReferenceImages ?? 1
  };
}

const workspaceTestUserA: AuthUser = {
  id: "workspace-user-a",
  email: "workspace-a@example.test",
  role: "USER",
  credits: 20,
  name: "Workspace user A"
};

const workspaceTestUserB: AuthUser = {
  id: "workspace-user-b",
  email: "workspace-b@example.test",
  role: "USER",
  credits: 20,
  name: "Workspace user B"
};

function WorkspaceAuthProbe() {
  const { logout, setAuthSession } = useWorkspaceShellContext();

  return (
    <>
      <button type="button" data-workspace-auth-logout="true" onClick={logout}>
        Logout
      </button>
      <button
        type="button"
        data-workspace-auth-switch="true"
        onClick={() =>
          setAuthSession({ token: "token-b", user: workspaceTestUserB })
        }
      >
        Switch account
      </button>
      <button
        type="button"
        data-workspace-auth-login-a="true"
        onClick={() =>
          setAuthSession({ token: "token-a", user: workspaceTestUserA })
        }
      >
        Login A
      </button>
    </>
  );
}

function renderImageWorkspace(
  props: Partial<React.ComponentProps<typeof ImagePageContent>> = {},
  locale: Locale = "en-US"
) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <ImagePageContent
        initialToken="token"
        initialCredits={20}
        initialModels={[imageModel()]}
        {...props}
      />
    </I18nContext.Provider>
  );
}

function renderImageWorkspaceWithMode(
  mode: string | null,
  props: Partial<React.ComponentProps<typeof ImagePageContent>> = {},
  locale: Locale = "en-US"
) {
  const previousUrl = window.location.href;
  const url = new URL(previousUrl);

  if (mode === null) {
    url.searchParams.delete("mode");
  } else {
    url.searchParams.set("mode", mode);
  }

  window.history.replaceState({}, "", url);

  try {
    return renderImageWorkspace(props, locale);
  } finally {
    window.history.replaceState({}, "", previousUrl);
  }
}

function setControlledFormValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("image workspace UI", () => {
  it("projects one Creator Workspace with truthful workflow and result contracts", () => {
    const html = renderImageWorkspace({}, "zh-CN");

    expect(html).toContain('data-image-creator-workspace="true"');
    expect(html).toContain('data-image-workflow-switcher="true"');
    expect(html).toContain('data-image-workflow="free-create"');
    expect(html).toContain('data-image-workflow="reference-edit"');
    expect(html).toContain('data-image-workflow="title-cover"');
    expect(html).toContain('data-image-workflow="transcript-images"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab" aria-selected="true"');
    expect(html).not.toContain('data-image-workflow="transcript-illustration"');
    expect(html).toContain('data-image-workflow-active-treatment="pill"');
    expect(html).not.toContain('border-b-2 border-slate-950');
    expect(html).toContain("自由创作");
    expect(html).toContain("精准改图");
    expect(html).not.toContain("参考图改图");
    expect(html).toContain("标题生成封面");
    expect(html).toContain("逐字稿生成配图");
    expect(html).toContain('data-image-creator-main="left-input-right-result"');
    expect(html).toContain('data-image-creator-input="true"');
    expect(html).toContain('data-image-creator-result="true"');
    expect(html).toContain('data-image-result-empty="true"');
    expect(html).not.toContain('data-image-mobile-mode-switch="true"');
    expect(html).not.toContain('data-image-desktop-mode-switch="true"');
    expect(html).not.toContain("Quick creation");
    expect(html).not.toContain("Creation workbench");
    expect(html).not.toContain("Comparison");
  });

  it("activates Precision Edit and blocks submission without a source image", async () => {
    const fetchMock = await mountGenerationPage({ initialPrompt: "Remove the background" });
    const precisionTab = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-workflow="reference-edit"]'
    );

    await act(async () => {
      precisionTab?.click();
      await Promise.resolve();
    });

    expect(precisionTab?.disabled).toBe(false);
    expect(precisionTab?.getAttribute("aria-selected")).toBe("true");
    expect(
      generationHost?.querySelector('[data-image-precision-edit-source-required="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-workbench-reference-input="true"]'
      )?.multiple
    ).toBe(false);
    expect(generationButton()?.disabled).toBe(true);

    await act(async () => {
      generationHost
        ?.querySelector<HTMLFormElement>('[data-image-workbench-editor="true"]')
        ?.requestSubmit();
      await Promise.resolve();
    });

    expect(generationPostCalls(fetchMock)).toHaveLength(0);
    expect(generationHost?.textContent).toContain("Upload an image to edit");
  });

  it("keeps Precision Edit to the first source without deleting the Free Create collection", async () => {
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Use the first source only",
      models: [imageModel({ maxReferenceImages: 4 })]
    });
    const input = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-workbench-reference-input="true"]'
    );
    Object.defineProperty(input ?? document.createElement("input"), "files", {
      configurable: true,
      value: [
        new File(["a"], "a.png", { type: "image/png" }),
        new File(["b"], "b.png", { type: "image/png" })
      ]
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    await settleGenerationPage();
    expect(generationHost?.querySelectorAll('[data-image-reference-item]')).toHaveLength(2);

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="reference-edit"]')
        ?.click();
      await Promise.resolve();
    });
    expect(generationHost?.querySelectorAll('[data-image-reference-item]')).toHaveLength(1);
    expect(generationHost?.textContent).toContain("a.png");
    expect(generationHost?.textContent).not.toContain("b.png");
    expect(generationButton()?.disabled).toBe(false);

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    expect(generationHost?.querySelectorAll('[data-image-reference-item]')).toHaveLength(2);
    expect(generationHost?.textContent).toContain("a.png");
    expect(generationHost?.textContent).toContain("b.png");

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="reference-edit"]')
        ?.click();
      await Promise.resolve();
    });
    await clickWorkspaceGenerationButton();
    const precisionPayload = JSON.parse(
      generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
    ) as { referenceImages?: Array<{ name?: string }> };
    expect(precisionPayload.referenceImages?.map((reference) => reference.name)).toEqual([
      "a.png"
    ]);
  });

  it("sends Precision Edit through the existing image-to-image request contract", async () => {
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Remove the background"
    });
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="reference-edit"]')
        ?.click();
      await Promise.resolve();
    });

    const referenceInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-workbench-reference-input="true"]'
    );
    const file = new File(["source"], "source.png", { type: "image/png" });
    Object.defineProperty(referenceInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [file]
    });
    await act(async () => {
      referenceInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();

    expect(generationButton()?.disabled).toBe(false);
    await clickWorkspaceGenerationButton();

    const payload = JSON.parse(
      generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      workflow: "precision-edit",
      mode: "image-to-image",
      prompt: "Remove the background",
      referenceImages: [{
        dataUrl: referenceCompressionDataUrl,
        mimeType: "image/jpeg",
        name: "source.png"
      }]
    });
    expect(generationHost?.querySelector('[data-image-workbench-result-success="true"]')).toBeTruthy();
  });

  it("keeps Free Create on the existing text-to-image request", async () => {
    const fetchMock = await mountGenerationPage({ initialPrompt: "A quiet reading room" });
    await clickWorkspaceGenerationButton();

    const payload = JSON.parse(
      generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      mode: "text-to-image",
      prompt: "A quiet reading room"
    });
    expect(payload).not.toHaveProperty("workflow");
    expect(payload).not.toHaveProperty("referenceImage");
    expect(payload).not.toHaveProperty("referenceImages");
  });

  it("appends, removes, reorders, and submits ordered multi-reference images", async () => {
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Combine the references",
      models: [imageModel({ maxReferenceImages: 4 })]
    });
    const selectFiles = async (files: File[]) => {
      const input = generationHost?.querySelector<HTMLInputElement>(
        '[data-image-workbench-reference-input="true"]'
      );
      Object.defineProperty(input ?? document.createElement("input"), "files", {
        configurable: true,
        value: files
      });
      await act(async () => {
        input?.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      });
      await settleGenerationPage();
    };

    await selectFiles([
      new File(["A"], "A.png", { type: "image/png" }),
      new File(["B"], "B.jpg", { type: "image/jpeg" })
    ]);
    await selectFiles([new File(["C"], "C.webp", { type: "image/webp" })]);

    const names = () =>
      Array.from(
        generationHost?.querySelectorAll<HTMLElement>(
          '[data-image-reference-item] p'
        ) ?? []
      ).map((element) => element.textContent);
    expect(names()).toEqual(["A.png", "B.jpg", "C.webp"]);

    const items = generationHost?.querySelectorAll<HTMLElement>(
      '[data-image-reference-item]'
    );
    await act(async () => {
      items?.[1]?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-reference-remove="true"]'
      )?.click();
      await Promise.resolve();
    });
    expect(names()).toEqual(["A.png", "C.webp"]);

    await act(async () => {
      generationHost?.querySelectorAll<HTMLElement>(
        '[data-image-reference-item]'
      )[1]?.querySelector<HTMLButtonElement>(
        '[data-image-reference-move-earlier="true"]'
      )?.click();
      await Promise.resolve();
    });
    expect(names()).toEqual(["C.webp", "A.png"]);

    await clickWorkspaceGenerationButton();
    const payload = JSON.parse(
      generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
    ) as Record<string, unknown>;
    expect(
      (payload.referenceImages as Array<{ name: string }>).map(
        (reference) => reference.name
      )
    ).toEqual(["C.webp", "A.png"]);
    expect(payload).not.toHaveProperty("referenceImage");
  });

  it("locks Free Create reference mutations while an appended batch is preparing", async () => {
    mockReferenceCompressionBrowser();
    await mountGenerationPage({
      initialPrompt: "Atomic reference append",
      models: [imageModel({ maxReferenceImages: 4 })]
    });
    const input = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-workbench-reference-input="true"]'
    );
    Object.defineProperty(input ?? document.createElement("input"), "files", {
      configurable: true,
      value: [
        new File(["A"], "A.png", { type: "image/png" }),
        new File(["B"], "B.png", { type: "image/png" })
      ]
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    await settleGenerationPage();
    restoreReferenceCompressionMocks?.();
    restoreReferenceCompressionMocks = null;

    const { pendingImages, pendingReaders } =
      mockDeferredReferenceCompressionBrowser();
    const currentInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-workbench-reference-input="true"]'
    );
    Object.defineProperty(currentInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["C"], "C.png", { type: "image/png" })]
    });
    await act(async () => {
      currentInput?.dispatchEvent(new Event("change", { bubbles: true }));
      pendingReaders[0]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();

    const mutationButtons = generationHost?.querySelectorAll<HTMLButtonElement>(
      '[data-image-reference-move-earlier="true"], [data-image-reference-move-later="true"], [data-image-workbench-reference-remove="true"]'
    );
    expect(Array.from(mutationButtons ?? []).every((button) => button.disabled)).toBe(true);
    expect(currentInput?.disabled).toBe(true);
    mutationButtons?.[mutationButtons.length - 1]?.click();

    Object.defineProperty(currentInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["D"], "D.png", { type: "image/png" })]
    });
    await act(async () => {
      currentInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: {
        files: [new File(["E"], "E.png", { type: "image/png" })],
        dropEffect: "copy"
      }
    });
    await act(async () => {
      generationHost
        ?.querySelector<HTMLElement>('[data-image-drag-upload="reference-image"]')
        ?.dispatchEvent(drop);
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(pendingReaders).toHaveLength(1);

    await act(async () => {
      pendingImages[0]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(
      Array.from(
        generationHost?.querySelectorAll<HTMLElement>(
          '[data-image-reference-item] p'
        ) ?? []
      ).map((element) => element.textContent)
    ).toEqual(["A.png", "B.png", "C.png"]);
  });

  it("locks Title Cover reference mutations while an appended batch is preparing", async () => {
    mockReferenceCompressionBrowser();
    await mountGenerationPage({
      models: [imageModel({ maxReferenceImages: 3 })]
    });
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const input = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    Object.defineProperty(input ?? document.createElement("input"), "files", {
      configurable: true,
      value: [
        new File(["A"], "title-A.png", { type: "image/png" }),
        new File(["B"], "title-B.png", { type: "image/png" })
      ]
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    await settleGenerationPage();
    restoreReferenceCompressionMocks?.();
    restoreReferenceCompressionMocks = null;

    const { pendingImages, pendingReaders } =
      mockDeferredReferenceCompressionBrowser();
    const currentInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    Object.defineProperty(currentInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["C"], "title-C.png", { type: "image/png" })]
    });
    await act(async () => {
      currentInput?.dispatchEvent(new Event("change", { bubbles: true }));
      pendingReaders[0]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();

    const mutationButtons = generationHost?.querySelectorAll<HTMLButtonElement>(
      '[data-image-reference-kind="title-cover"] button'
    );
    expect(Array.from(mutationButtons ?? []).every((button) => button.disabled)).toBe(true);
    expect(currentInput?.disabled).toBe(true);
    mutationButtons?.[mutationButtons.length - 1]?.click();
    Object.defineProperty(currentInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["D"], "title-D.png", { type: "image/png" })]
    });
    await act(async () => {
      currentInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: {
        files: [new File(["E"], "title-E.png", { type: "image/png" })],
        dropEffect: "copy"
      }
    });
    await act(async () => {
      generationHost
        ?.querySelector<HTMLElement>('[data-image-title-cover-reference-preview="true"]')
        ?.dispatchEvent(drop);
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(pendingReaders).toHaveLength(1);

    await act(async () => {
      pendingImages[0]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(
      Array.from(
        generationHost?.querySelectorAll<HTMLElement>(
          '[data-image-reference-kind="title-cover"] p'
        ) ?? []
      ).map((element) => element.textContent)
    ).toEqual(["title-A.png", "title-B.png", "title-C.png"]);
    const fullInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    expect(fullInput?.disabled).toBe(true);
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-title-cover-reference-remove="true"]'
      )?.disabled
    ).toBe(false);
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>(
          '[data-image-title-cover-reference-remove="true"]'
        )
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-title-cover-reference-input="true"]'
      )?.disabled
    ).toBe(false);
  });

  it("keeps the existing Free Create collection after an appended batch fails", async () => {
    mockReferenceCompressionBrowser();
    await mountGenerationPage({
      initialPrompt: "Atomic failure",
      models: [imageModel({ maxReferenceImages: 4 })]
    });
    const input = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-workbench-reference-input="true"]'
    );
    Object.defineProperty(input ?? document.createElement("input"), "files", {
      configurable: true,
      value: [
        new File(["A"], "A.png", { type: "image/png" }),
        new File(["B"], "B.png", { type: "image/png" })
      ]
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    await settleGenerationPage();
    restoreReferenceCompressionMocks?.();
    restoreReferenceCompressionMocks = null;

    const { pendingImages, pendingReaders } =
      mockDeferredReferenceCompressionBrowser();
    const currentInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-workbench-reference-input="true"]'
    );
    Object.defineProperty(currentInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["C"], "C.png", { type: "image/png" })]
    });
    await act(async () => {
      currentInput?.dispatchEvent(new Event("change", { bubbles: true }));
      pendingReaders[0]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();
    await act(async () => {
      pendingImages[0]?.onerror?.();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(
      Array.from(
        generationHost?.querySelectorAll<HTMLElement>(
          '[data-image-reference-item] p'
        ) ?? []
      ).map((element) => element.textContent)
    ).toEqual(["A.png", "B.png"]);
    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-workbench-reference-input="true"]'
      )?.disabled
    ).toBe(false);
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-reference-remove="true"]'
      )?.disabled
    ).toBe(false);
  });

  it("disables a full Free Create input without changing Precision replacement", async () => {
    mockReferenceCompressionBrowser();
    await mountGenerationPage({
      initialPrompt: "Capacity one",
      models: [imageModel({ maxReferenceImages: 1 })]
    });
    const selectCurrent = async (name: string) => {
      const input = generationHost?.querySelector<HTMLInputElement>(
        '[data-image-workbench-reference-input="true"]'
      );
      Object.defineProperty(input ?? document.createElement("input"), "files", {
        configurable: true,
        value: [new File([name], name, { type: "image/png" })]
      });
      await act(async () => {
        input?.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      });
      await settleGenerationPage();
    };
    await selectCurrent("A.png");
    const fullInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-workbench-reference-input="true"]'
    );
    expect(fullInput?.disabled).toBe(true);
    expect(fullInput?.closest("label")?.textContent).not.toContain("Replace reference");
    const remove = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-workbench-reference-remove="true"]'
    );
    expect(remove?.disabled).toBe(false);
    await act(async () => {
      remove?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-workbench-reference-input="true"]'
      )?.disabled
    ).toBe(false);

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="reference-edit"]')
        ?.click();
      await Promise.resolve();
    });
    await selectCurrent("precision.png");
    const precisionInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-workbench-reference-input="true"]'
    );
    expect(precisionInput?.disabled).toBe(false);
    expect(precisionInput?.multiple).toBe(false);
    expect(precisionInput?.closest("label")?.textContent).toContain("Replace");
  });

  it("reopens Free Create capacity after removing one of four references", async () => {
    mockReferenceCompressionBrowser();
    await mountGenerationPage({
      initialPrompt: "Capacity four",
      models: [imageModel({ maxReferenceImages: 4 })]
    });
    const input = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-workbench-reference-input="true"]'
    );
    Object.defineProperty(input ?? document.createElement("input"), "files", {
      configurable: true,
      value: ["A", "B", "C", "D"].map(
        (name) => new File([name], `${name}.png`, { type: "image/png" })
      )
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    await settleGenerationPage();
    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-workbench-reference-input="true"]'
      )?.disabled
    ).toBe(true);
    const remove = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-workbench-reference-remove="true"]'
    );
    expect(remove?.disabled).toBe(false);
    await act(async () => {
      remove?.click();
      await Promise.resolve();
    });
    expect(generationHost?.querySelectorAll('[data-image-reference-item]')).toHaveLength(3);
    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-workbench-reference-input="true"]'
      )?.disabled
    ).toBe(false);
  });

  it("retains over-capacity references across model switches until the user removes one", async () => {
    mockReferenceCompressionBrowser();
    const high = imageModel({ maxReferenceImages: 4 });
    const low = imageModel({
      id: "model-low",
      slug: "image-model-low",
      modelId: "image-model-low",
      name: "Low capacity",
      displayName: "Low capacity",
      maxReferenceImages: 1
    });
    await mountGenerationPage({
      initialPrompt: "Keep both references",
      models: [high, low]
    });
    const input = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-workbench-reference-input="true"]'
    );
    Object.defineProperty(input ?? document.createElement("input"), "files", {
      configurable: true,
      value: [
        new File(["A"], "A.png", { type: "image/png" }),
        new File(["B"], "B.png", { type: "image/png" })
      ]
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    await settleGenerationPage();

    const model = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-model="true"]'
    );
    await act(async () => {
      if (model) setControlledFormValue(model, low.slug);
      await Promise.resolve();
    });
    expect(generationHost?.querySelectorAll('[data-image-reference-item]')).toHaveLength(2);
    expect(generationHost?.querySelector('[data-image-reference-limit-error="true"]')).toBeTruthy();
    expect(generationButton()?.disabled).toBe(true);

    await act(async () => {
      generationHost?.querySelectorAll<HTMLElement>('[data-image-reference-item]')[1]
        ?.querySelector<HTMLButtonElement>('[data-image-workbench-reference-remove="true"]')
        ?.click();
      await Promise.resolve();
    });
    expect(generationHost?.querySelectorAll('[data-image-reference-item]')).toHaveLength(1);
    expect(generationButton()?.disabled).toBe(false);
  });

  it("rejects an over-limit or invalid append batch without changing existing references", async () => {
    mockReferenceCompressionBrowser();
    await mountGenerationPage({
      initialPrompt: "Atomic append",
      models: [imageModel({ maxReferenceImages: 2 })]
    });
    const selectFiles = async (files: File[]) => {
      const input = generationHost?.querySelector<HTMLInputElement>(
        '[data-image-workbench-reference-input="true"]'
      );
      Object.defineProperty(input ?? document.createElement("input"), "files", {
        configurable: true,
        value: files
      });
      await act(async () => {
        input?.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      await settleGenerationPage();
    };
    await selectFiles([new File(["A"], "A.png", { type: "image/png" })]);
    await selectFiles([
      new File(["B"], "B.png", { type: "image/png" }),
      new File(["C"], "C.png", { type: "image/png" })
    ]);
    expect(generationHost?.querySelectorAll('[data-image-reference-item]')).toHaveLength(1);
    expect(generationHost?.textContent).toContain("A.png");

    await selectFiles([
      new File(["B"], "B.png", { type: "image/png" }),
      new File(["bad"], "bad.txt", { type: "text/plain" })
    ]);
    expect(generationHost?.querySelectorAll('[data-image-reference-item]')).toHaveLength(1);
    expect(generationHost?.textContent).toContain("A.png");
  });

  it("uses the first ordered reference dimensions for Auto after reorder", () => {
    const references = [
      {
        id: "A",
        image: { dataUrl: "data:image/png;base64,QQ==", mimeType: "image/png" },
        dimensions: { width: 600, height: 900 }
      },
      {
        id: "B",
        image: { dataUrl: "data:image/png;base64,Qg==", mimeType: "image/png" },
        dimensions: { width: 900, height: 600 }
      }
    ];
    expect(resolveImageGenerationSize("auto", "image-to-image", references[0]!.dimensions, "")).toBe("768x1024");
    const reordered = moveSelectedReferenceImage(references, "B", -1);
    expect(resolveImageGenerationSize("auto", "image-to-image", reordered[0]!.dimensions, "")).toBe("1024x768");
  });

  it("uses exact valid model reference capacities and safely falls back to one", () => {
    expect([0, 1, 4].map(resolveModelMaxReferenceImages)).toEqual([0, 1, 4]);
    expect([-1, 5, 1.5, Number.NaN, undefined].map(resolveModelMaxReferenceImages)).toEqual([1, 1, 1, 1, 1]);
  });

  it("disables reference selection when the selected model supports zero references", async () => {
    await mountGenerationPage({
      initialPrompt: "Text only",
      models: [imageModel({ maxReferenceImages: 0 })]
    });
    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-workbench-reference-input="true"]'
      )?.disabled
    ).toBe(true);
    expect(generationHost?.querySelector('[data-image-reference-unsupported="true"]')).toBeTruthy();
    expect(generationButton()?.disabled).toBe(false);
  });

  it("keeps ordered reference controls touch-friendly in the mobile composer", async () => {
    mockReferenceCompressionBrowser();
    await mountGenerationPage({
      mobile: true,
      initialPrompt: "Mobile references",
      models: [imageModel({ maxReferenceImages: 4 })]
    });
    const input = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-mobile-reference-input="true"]'
    );
    expect(input?.multiple).toBe(true);
    Object.defineProperty(input ?? document.createElement("input"), "files", {
      configurable: true,
      value: [
        new File(["A"], "A.png", { type: "image/png" }),
        new File(["B"], "B.png", { type: "image/png" })
      ]
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    await settleGenerationPage();

    expect(generationHost?.querySelectorAll('[data-image-reference-item]')).toHaveLength(2);
    expect(generationHost?.querySelectorAll('[data-image-reference-move-earlier="true"]')).toHaveLength(2);
    expect(generationHost?.querySelectorAll('[data-image-reference-move-later="true"]')).toHaveLength(2);
    expect(generationHost?.querySelectorAll('[data-image-workbench-reference-remove="true"]')).toHaveLength(2);
    expect(generationHost?.querySelector('[data-image-mobile-compact-composer="true"]')).toBeTruthy();
    expect(generationButton()?.disabled).toBe(false);
  });

  it("plans Transcript to Images locally and keeps an empty transcript blocked", async () => {
    const fetchMock = await mountGenerationPage({ initialPrompt: "" });
    await activateTranscriptImagesWorkflow();

    const planButton = generationHost?.querySelector<HTMLButtonElement>(
      '[data-transcript-plan="true"]'
    );
    expect(planButton).toBeTruthy();

    await act(async () => {
      planButton?.click();
      await Promise.resolve();
    });

    expect(generationPostCalls(fetchMock)).toHaveLength(0);
    expect(generationHost?.querySelectorAll('[data-transcript-scene-card="true"]')).toHaveLength(0);
    expect(generationHost?.querySelector('[data-transcript-error="true"]')?.textContent).toContain(
      "Paste a transcript first"
    );
  });

  it("uses the shared image model selector for Transcript planning and generation", async () => {
    const secondModel = imageModel({
      id: "model_image_two",
      slug: "image-model-two",
      modelId: "image-model-two",
      name: "Second Image Model",
      displayName: "Second Image Model",
      sortOrder: 1
    });
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Free prompt",
      models: [imageModel(), secondModel]
    });
    await activateTranscriptImagesWorkflow();

    const modelSelect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-transcript-model="true"]'
    );
    expect(modelSelect?.options).toHaveLength(2);
    expect(modelSelect?.value).toBe("image-model");

    await act(async () => {
      setControlledFormValue(modelSelect as HTMLSelectElement, "image-model-two");
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLSelectElement>('[data-transcript-model="true"]')
        ?.value
    ).toBe("image-model-two");
    expect(generationPostCalls(fetchMock)).toHaveLength(0);

    const transcript = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-transcript-input="true"]'
    );
    await act(async () => {
      if (transcript) {
        setControlledFormValue(transcript, "第一段画面。\n\n第二段画面。");
      }
      await Promise.resolve();
    });
    await clickTranscriptPlanButton();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);

    await clickTranscriptGenerateButton();
    const payloads = generationPostCalls(fetchMock).map((call) =>
      JSON.parse(generationRequestBody(call)) as Record<string, unknown>
    );
    expect(payloads).toHaveLength(2);
    expect(payloads.every((payload) => payload.modelId === "image-model-two")).toBe(true);
  });

  it("blocks Transcript generation when no image models are available", async () => {
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Free prompt",
      models: []
    });
    await activateTranscriptImagesWorkflow();

    const modelSelect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-transcript-model="true"]'
    );
    expect(modelSelect?.disabled).toBe(true);
    expect(modelSelect?.textContent).toContain("No image models configured");

    const transcript = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-transcript-input="true"]'
    );
    await act(async () => {
      if (transcript) {
        setControlledFormValue(transcript, "A scene without a model.");
      }
      await Promise.resolve();
    });
    await clickTranscriptPlanButton();

    const generateButton = generationHost?.querySelector<HTMLButtonElement>(
      '[data-transcript-generate-selected="true"]'
    );
    expect(generateButton?.disabled).toBe(true);
    await clickTranscriptGenerateButton();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("creates editable scene cards with a four-scene selection ceiling", async () => {
    await mountGenerationPage({ initialPrompt: "Free prompt" });
    await activateTranscriptImagesWorkflow();
    const transcript = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-transcript-input="true"]'
    );
    expect(transcript?.getAttribute("maxlength")).toBeNull();

    await act(async () => {
      if (transcript) {
        setControlledFormValue(
          transcript,
          [
            "第一段内容。",
            "第二段内容。",
            "第三段内容。",
            "第四段内容。",
            "第五段内容。",
            "第六段内容。"
          ].join("\n\n")
        );
      }
      await Promise.resolve();
    });
    await clickTranscriptPlanButton();

    const cards = generationHost?.querySelectorAll('[data-transcript-scene-card="true"]');
    const prompts = generationHost?.querySelectorAll<HTMLTextAreaElement>(
      '[data-transcript-scene-prompt="true"]'
    );
    const selections = generationHost?.querySelectorAll<HTMLInputElement>(
      '[data-transcript-scene-select="true"]'
    );
    expect(cards).toHaveLength(6);
    expect(prompts?.[0]?.value).toContain("Create a visual scene");
    expect(selections).toHaveLength(6);
    expect(Array.from(selections ?? []).filter((input) => input.checked)).toHaveLength(4);
    expect(selections?.[4]?.disabled).toBe(true);

    await act(async () => {
      if (prompts?.[0]) {
        setControlledFormValue(prompts[0], "EDITED_TRANSCRIPT_SCENE_PROMPT");
      }
      await Promise.resolve();
    });
    expect(prompts?.[0]?.value).toBe("EDITED_TRANSCRIPT_SCENE_PROMPT");

    await act(async () => {
      for (const input of Array.from(selections ?? []).slice(0, 4)) {
        input.click();
      }
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-transcript-generate-selected="true"]'
      )?.disabled
    ).toBe(true);
  });

  it("invalidates a stale Transcript scene plan when the transcript changes", async () => {
    const fetchMock = await mountGenerationPage({ initialPrompt: "Free prompt" });
    await activateTranscriptImagesWorkflow();
    const transcript = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-transcript-input="true"]'
    );

    await act(async () => {
      if (transcript) {
        setControlledFormValue(transcript, "Transcript A.");
      }
      await Promise.resolve();
    });
    await clickTranscriptPlanButton();
    expect(
      generationHost?.querySelectorAll('[data-transcript-scene-card="true"]')
    ).toHaveLength(1);

    await act(async () => {
      if (transcript) {
        setControlledFormValue(transcript, "Transcript B.");
      }
      await Promise.resolve();
    });

    expect(
      generationHost?.querySelectorAll('[data-transcript-scene-card="true"]')
    ).toHaveLength(0);
    expect(
      generationHost?.querySelector('[data-transcript-generate-selected="true"]')
    ).toBeFalsy();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("locks Transcript editing and actions during an unresolved generation", async () => {
    const deferred = createDeferred<Response>();
    let pendingPayload: object | null = null;
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Free prompt",
      postHandler: async (_index, payload) => {
        pendingPayload = payload;
        return deferred.promise;
      }
    });
    await activateTranscriptImagesWorkflow();
    const transcript = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-transcript-input="true"]'
    );

    await act(async () => {
      if (transcript) {
        setControlledFormValue(transcript, "Transcript A.");
      }
      await Promise.resolve();
    });
    await clickTranscriptPlanButton();
    await clickTranscriptGenerateButton();

    expect(transcript?.disabled).toBe(true);
    expect(
      generationHost?.querySelector<HTMLSelectElement>('[data-transcript-model="true"]')
        ?.disabled
    ).toBe(true);
    expect(
      generationHost?.querySelector<HTMLButtonElement>('[data-transcript-plan="true"]')
        ?.disabled
    ).toBe(true);
    expect(
      generationHost?.querySelector<HTMLInputElement>('[data-transcript-scene-select="true"]')
        ?.disabled
    ).toBe(true);
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>('[data-transcript-scene-prompt="true"]')
        ?.disabled
    ).toBe(true);
    expect(
      generationHost?.querySelector<HTMLButtonElement>('[data-transcript-generate-selected="true"]')
        ?.disabled
    ).toBe(true);
    expect(generationPostCalls(fetchMock)).toHaveLength(1);

    deferred.resolve(
      generationJsonResponse(
        createGenerationResponse(pendingPayload ?? {}, { taskId: "task-transcript-lock" })
      )
    );
    await settleGenerationPage();
    await settleGenerationPage();
    expect(
      generationHost?.querySelectorAll('[data-transcript-scene-status="succeeded"]')
    ).toHaveLength(1);
  });

  it("keeps Transcript state isolated while switching Creator workflows", async () => {
    await mountGenerationPage({ initialPrompt: "Free prompt" });
    await activateTranscriptImagesWorkflow();
    const transcript = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-transcript-input="true"]'
    );

    await act(async () => {
      if (transcript) {
        setControlledFormValue(transcript, "Transcript-only scene.");
      }
      await Promise.resolve();
    });
    await clickTranscriptPlanButton();
    expect(generationHost?.querySelectorAll('[data-transcript-scene-card="true"]')).toHaveLength(1);

    await activateTitleCoverWorkflow();
    expect(generationHost?.querySelector('[data-transcript-input="true"]')).toBeFalsy();
    expect(generationHost?.querySelector('[data-transcript-scene-card="true"]')).toBeFalsy();

    await activateTranscriptImagesWorkflow();
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>('[data-transcript-input="true"]')?.value
    ).toBe("Transcript-only scene.");
    expect(generationHost?.querySelector('[data-transcript-scene-card="true"]')).toBeTruthy();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>('[data-image-workbench-prompt="true"]')?.value
    ).toBe("Free prompt");
    expect(generationHost?.querySelector('[data-transcript-scene-card="true"]')).toBeFalsy();
  });

  it("generates selected Transcript scenes sequentially without reference leakage", async () => {
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Free prompt",
      initialReferenceImage: {
        dataUrl: referenceCompressionDataUrl,
        mimeType: "image/jpeg",
        name: "free-reference.jpg",
        originalBytes: 10,
        compressedBytes: 10
      },
      postHandler: async (index, payload) =>
        generationJsonResponse(
          createGenerationResponse(payload, {
            taskId: `task-transcript-${index}`
          })
        )
    });
    await activateTranscriptImagesWorkflow();
    const transcript = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-transcript-input="true"]'
    );
    await act(async () => {
      if (transcript) {
        setControlledFormValue(transcript, "第一段画面。\n\n第二段画面。");
      }
      await Promise.resolve();
    });
    await clickTranscriptPlanButton();
    const firstPrompt = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-transcript-scene-prompt="true"]'
    );
    await act(async () => {
      if (firstPrompt) {
        setControlledFormValue(firstPrompt, "EDITED_TRANSCRIPT_SCENE_PROMPT");
      }
      await Promise.resolve();
    });
    await clickTranscriptGenerateButton();

    const postCalls = generationPostCalls(fetchMock);
    expect(postCalls).toHaveLength(2);
    const payloads = postCalls.map((call) =>
      JSON.parse(generationRequestBody(call)) as Record<string, unknown>
    );
    expect(payloads.map((payload) => payload.clientEntryId)).toHaveLength(2);
    expect(new Set(payloads.map((payload) => payload.clientEntryId)).size).toBe(2);
    expect(payloads[0]).toMatchObject({
      workflow: "transcript-images",
      mode: "text-to-image",
      count: 1,
      prompt: "EDITED_TRANSCRIPT_SCENE_PROMPT"
    });
    expect(payloads[1]).toMatchObject({
      workflow: "transcript-images",
      mode: "text-to-image",
      count: 1
    });
    expect(payloads[0]).not.toHaveProperty("referenceImage");
    expect(payloads[1]).not.toHaveProperty("referenceImage");
    expect(
      generationHost?.querySelectorAll('[data-transcript-scene-result="true"]')
    ).toHaveLength(2);
  });

  it("keeps successful Transcript scenes when a later scene fails", async () => {
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Free prompt",
      postHandler: async (index, payload) =>
        index === 0
          ? generationJsonResponse(
              createGenerationResponse(payload, { taskId: "task-transcript-success" })
            )
          : generationJsonResponse(
              {
                code: "IMAGE_GENERATION_FAILED",
                message: "scene failure",
                retryable: true
              },
              500
            )
    });
    await activateTranscriptImagesWorkflow();
    const transcript = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-transcript-input="true"]'
    );
    await act(async () => {
      if (transcript) {
        setControlledFormValue(transcript, "第一段画面。\n\n第二段画面。");
      }
      await Promise.resolve();
    });
    await clickTranscriptPlanButton();
    await clickTranscriptGenerateButton();

    expect(generationPostCalls(fetchMock)).toHaveLength(2);
    expect(
      generationHost?.querySelectorAll('[data-transcript-scene-status="succeeded"]')
    ).toHaveLength(1);
    expect(
      generationHost?.querySelectorAll('[data-transcript-scene-status="failed"]')
    ).toHaveLength(1);
    expect(
      generationHost?.querySelectorAll('[data-transcript-scene-result="true"]')
    ).toHaveLength(1);
  });

  it("activates Title Cover with structured copy and keeps empty required fields blocked", async () => {
    const fetchMock = await mountGenerationPage({ initialPrompt: "Free draft" });
    const titleTab = () =>
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workflow="title-cover"]'
      );

    await act(async () => {
      titleTab()?.click();
      await Promise.resolve();
    });

    expect(titleTab()?.getAttribute("aria-selected")).toBe("true");
    expect(
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.getAttribute("aria-selected")
    ).toBe("false");
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workflow="reference-edit"]'
      )?.disabled
    ).toBe(false);
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workflow="transcript-images"]'
      )?.disabled
    ).toBe(false);

    const form = generationHost?.querySelector<HTMLFormElement>(
      '[data-image-title-cover-form="true"]'
    );
    const originalTitle = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-original-title="true"]'
    );
    const mainCopy = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-title-cover-main-copy="true"]'
    );
    const secondaryCopy = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-title-cover-secondary-copy="true"]'
    );
    expect(form).toBeTruthy();
    expect(originalTitle?.value).toBe("");
    expect(mainCopy?.value).toBe("");
    expect(secondaryCopy?.value).toBe("");
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-title-cover-generate="true"]'
      )?.disabled
    ).toBe(true);
    expect(
      generationHost?.querySelector('[data-image-title-cover-result-empty="true"]')
    ).toBeTruthy();

    await act(async () => {
      if (originalTitle) {
        setControlledFormValue(originalTitle, "原始标题");
      }
    });
    expect(mainCopy?.value).toBe("原始标题");
    expect(form?.getAttribute("data-image-title-cover-main-copy-dirty")).toBe(
      "false"
    );

    await act(async () => {
      if (mainCopy) {
        setControlledFormValue(mainCopy, "精确主文案");
      }
      await Promise.resolve();
    });
    expect(form?.getAttribute("data-image-title-cover-main-copy-dirty")).toBe(
      "true"
    );
    await act(async () => {
      if (originalTitle) {
        setControlledFormValue(originalTitle, "更新后的标题");
      }
      await Promise.resolve();
    });
    expect(mainCopy?.value).toBe("精确主文案");

    await act(async () => {
      if (mainCopy) {
        setControlledFormValue(mainCopy, "");
      }
      if (originalTitle) {
        setControlledFormValue(originalTitle, "再次修改标题");
      }
      await Promise.resolve();
    });
    expect(mainCopy?.value).toBe("");

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-title-cover-generate="true"]')
        ?.click();
      await Promise.resolve();
    });
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
    expect(
      fetchMock.mock.calls.some(([input, init]) =>
        init?.method === "POST" && generationUrl(input).pathname.endsWith("/tasks")
      )
      ).toBe(false);
  });

  it("generates a Title Cover visual base through the existing request contract", async () => {
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Free draft must remain untouched",
      postHandler: async (_index, payload) =>
        generationJsonResponse(
          createGenerationResponse(payload, {
            taskId: "task-title-cover-base",
            imageUrls: [
              "https://cdn.example.test/title-cover-1.png",
              "https://cdn.example.test/title-cover-2.png"
            ]
          })
        )
    });

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const originalTitle = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-original-title="true"]'
    );
    const mainCopy = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-title-cover-main-copy="true"]'
    );
    const secondaryCopy = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-title-cover-secondary-copy="true"]'
    );
    const aspect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-title-cover-aspect="true"]'
    );
    await act(async () => {
      if (originalTitle) setControlledFormValue(originalTitle, "AI workflow title");
      if (mainCopy) setControlledFormValue(mainCopy, "Exact headline");
      if (secondaryCopy) setControlledFormValue(secondaryCopy, "Exact subtitle");
      if (aspect) setControlledFormValue(aspect, "4:3");
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-generation-count-option="2"]')
        ?.click();
      await Promise.resolve();
    });

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-title-cover-generate="true"]')
        ?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    const postCalls = generationPostCalls(fetchMock);
    expect(postCalls).toHaveLength(1);
    const payload = JSON.parse(generationRequestBody(postCalls[0] ?? [])) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      modelId: "image-model",
      size: "1024x768",
      count: 2,
      mode: "text-to-image"
    });
    expect(typeof payload.prompt).toBe("string");
    expect(payload.prompt).toContain("AI workflow title");
    expect(payload.prompt).not.toContain("Exact headline");
    expect(payload.prompt).not.toContain("Exact subtitle");
    expect(payload).toMatchObject({
      workflow: "title-cover",
      titleCover: {
        originalTitle: "AI workflow title",
        style: "minimal-modern"
      }
    });
    expect(payload).toHaveProperty("imageSessionId");
    expect(payload).toHaveProperty("clientEntryId");
    expect(payload).toHaveProperty("imageSessionTitle");
    expect(payload).not.toHaveProperty("mainCopy");
    expect(payload).not.toHaveProperty("secondaryCopy");
    expect(payload).not.toHaveProperty("style");
    expect(generationHost?.querySelectorAll('[data-image-workbench-result-entry]')).toHaveLength(2);
    expect(generationHost?.querySelector('[data-image-title-cover-result-description="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-workbench-download="true"]')).toBeNull();
    expect(generationHost?.querySelector('[data-image-creator-result-hero="true"]')).toBeNull();
    expect(creationWorkspaceSource).toContain("enabled: showDownload");
    expect(generationHost?.querySelector('[data-image-workbench-asset-link="true"]')).toBeNull();
    expect(generationHost?.querySelector('[data-image-workbench-reuse-prompt="true"]')).toBeNull();
    expect(generationHost?.querySelector('[data-image-workbench-continue-editing="true"]')).toBeNull();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>('[data-image-workbench-prompt="true"]')
        ?.value
    ).toBe("Free draft must remain untouched");
    expect(generationHost?.querySelector('[data-image-workbench-reuse-prompt="true"]')).toBeNull();
  });

  it("uses the real Title Cover Generate button and keeps the loading click single-flight", async () => {
    const response = createDeferred<Response>();
    const fetchMock = await mountGenerationPage({
      postHandler: async () => response.promise
    });

    await activateTitleCoverWorkflow();
    await fillTitleCoverDraft("Single-flight title", "Single-flight copy");

    const button = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-title-cover-generate="true"]'
    );
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute("aria-disabled")).toBeNull();
    expect(button?.getAttribute("data-image-generate-request-flow")).toBe(
      "unchanged"
    );
    expect(
      generationHost?.querySelector('[data-image-title-cover-safety]')
    ).toBeNull();
    expect(generationHost?.textContent).not.toContain(
      "Generation will be enabled in the next batch"
    );

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(generationPostCalls(fetchMock)).toHaveLength(1);

    const payload = readGenerationPayload(
      generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
    );
    await act(async () => {
      response.resolve(generationJsonResponse(createGenerationResponse(payload)));
      await response.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-workbench-result-success="true"]')).toBeTruthy();
  });

  it("keeps a foreign Title Cover request alive when Free Create New Creation is requested", async () => {
    const response = createDeferred<Response>();
    let requestSignal: AbortSignal | undefined;
    const fetchMock = await mountGenerationPage({
      postHandler: async (_index, _payload, init) => {
        requestSignal = init?.signal as AbortSignal | undefined;
        return response.promise;
      }
    });

    await activateTitleCoverWorkflow();
    await fillTitleCoverDraft("Foreign title request", "Foreign copy");
    await clickTitleCoverGenerateButton();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });

    const newButton = newDrawingButton();
    expect(newButton?.disabled).toBe(true);
    expect(requestSignal?.aborted).toBe(false);
    newButton?.removeAttribute("disabled");
    await act(async () => {
      newButton?.click();
      await Promise.resolve();
    });
    expect(requestSignal?.aborted).toBe(false);
    expect(generationHost?.querySelector('[role="dialog"]')).toBeNull();

    const payload = readGenerationPayload(
      generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
    );
    await act(async () => {
      response.resolve(generationJsonResponse(createGenerationResponse(payload)));
      await response.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();

    await activateTitleCoverWorkflow();
    expect(
      generationHost?.querySelector('[data-image-workbench-result-success="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-title-cover-result-description="true"]')
    ).toBeTruthy();
  });

  it("keeps a foreign Free Create request alive when Title Cover New Creation is requested", async () => {
    const response = createDeferred<Response>();
    let requestSignal: AbortSignal | undefined;
    const fetchMock = await mountGenerationPage({
      postHandler: async (_index, _payload, init) => {
        requestSignal = init?.signal as AbortSignal | undefined;
        return response.promise;
      }
    });

    await clickGenerationButton();
    await activateTitleCoverWorkflow();

    const newButton = newDrawingButton();
    expect(newButton?.disabled).toBe(true);
    expect(requestSignal?.aborted).toBe(false);
    newButton?.removeAttribute("disabled");
    await act(async () => {
      newButton?.click();
      await Promise.resolve();
    });
    expect(requestSignal?.aborted).toBe(false);
    expect(generationHost?.querySelector('[role="dialog"]')).toBeNull();

    const payload = readGenerationPayload(
      generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
    );
    await act(async () => {
      response.resolve(generationJsonResponse(createGenerationResponse(payload)));
      await response.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector('[data-image-workbench-result-success="true"]')
    ).toBeTruthy();
  });

  it("uses the existing image-to-image request for a prepared Title Cover reference", async () => {
    mockReferenceCompressionBrowser({ width: 800, height: 600 });
    const fetchMock = await mountGenerationPage({
      models: [imageModel({ maxReferenceImages: 4 })]
    });

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const originalTitle = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-original-title="true"]'
    );
    const mainCopy = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-title-cover-main-copy="true"]'
    );
    await act(async () => {
      if (originalTitle) setControlledFormValue(originalTitle, "Reference-led title");
      if (mainCopy) setControlledFormValue(mainCopy, "Exact cover copy");
      await Promise.resolve();
    });
    const referenceInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    Object.defineProperty(referenceInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [
        new File(["reference-a"], "title-a.png", { type: "image/png" }),
        new File(["reference-b"], "title-b.jpg", { type: "image/jpeg" })
      ]
    });
    await act(async () => {
      referenceInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    await settleGenerationPage();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-title-cover-generate="true"]')
        ?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    const payload = JSON.parse(
      generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      mode: "image-to-image",
      size: "1280x720",
      count: 1,
      referenceImages: [
        { dataUrl: referenceCompressionDataUrl, mimeType: "image/jpeg", name: "title-a.png" },
        { dataUrl: referenceCompressionDataUrl, mimeType: "image/jpeg", name: "title-b.jpg" }
      ]
    });
    expect(payload).not.toHaveProperty("referenceImage");
  });

  it("keeps Title Cover Generate disabled while reference preparation is compressing or failed", async () => {
    const { pendingImages, pendingReaders } =
      mockDeferredReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const originalTitle = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-original-title="true"]'
    );
    const mainCopy = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-title-cover-main-copy="true"]'
    );
    await act(async () => {
      if (originalTitle) setControlledFormValue(originalTitle, "Reference pending");
      if (mainCopy) setControlledFormValue(mainCopy, "Exact cover copy");
      await Promise.resolve();
    });

    const input = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    Object.defineProperty(input ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["pending"], "pending-reference.png", { type: "image/png" })]
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      pendingReaders[0]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();

    const generateButton = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-title-cover-generate="true"]'
    );
    expect(pendingImages).toHaveLength(1);
    expect(generateButton?.disabled).toBe(true);
    expect(generationPostCalls(fetchMock)).toHaveLength(0);

    pendingImages[0]?.onerror?.();
    await settleGenerationPage();
    expect(generateButton?.disabled).toBe(true);
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("keeps a frozen Title Cover visual request for retry after structured edits", async () => {
    const fetchMock = await mountGenerationPage({
      postHandler: async (index, payload) =>
        index === 0
          ? generationJsonResponse(
              {
                message: "Safe terminal failure",
                code: "IMAGE_GENERATION_FAILED",
                retryable: true
              },
              500
            )
          : generationJsonResponse(
              createGenerationResponse(payload, { taskId: "task-title-cover-retry" })
            )
    });

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const originalTitle = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-original-title="true"]'
    );
    const mainCopy = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-title-cover-main-copy="true"]'
    );
    await act(async () => {
      if (originalTitle) setControlledFormValue(originalTitle, "Frozen cover title");
      if (mainCopy) setControlledFormValue(mainCopy, "Frozen exact copy");
      await Promise.resolve();
    });
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-title-cover-generate="true"]')
        ?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(retryGenerationAsNewRequestButton()).toBeTruthy();
    const firstBody = generationRequestBody(generationPostCalls(fetchMock)[0] ?? []);

    const style = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-title-cover-style="true"]'
    );
    await act(async () => {
      if (originalTitle) setControlledFormValue(originalTitle, "Changed after failure");
      if (style) setControlledFormValue(style, "warm-editorial");
      await Promise.resolve();
    });
    await clickRetryGenerationAsNewRequestButton();

    expect(generationPostCalls(fetchMock)).toHaveLength(2);
    expect(generationRequestBody(generationPostCalls(fetchMock)[1] ?? [])).toBe(firstBody);
    expect(generationHost?.querySelector('[data-image-workbench-result-success="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-workbench-download="true"]')).toBeNull();
  });

  it("routes a failed first recovery lookup into Title Cover polling and fences Retry by workflow", async () => {
    vi.useFakeTimers();
    const fetchMock = await mountGenerationPage({
      reconcileStatuses: ["failed", "failed"],
      postHandler: async () =>
        generationJsonResponse(
          { status: "in_progress", taskId: "task-title-cover-pending", retryAfterMs: 2500 },
          202
        )
    });

    await activateTitleCoverWorkflow();
    await fillTitleCoverDraft("Pending title", "Pending copy");
    await clickTitleCoverGenerateButton();
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationReconcileCalls(fetchMock)).toHaveLength(1);
    expect(generationHost?.querySelector('[data-image-ai-status="checking"]')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await settleGenerationPage();

    expect(generationReconcileCalls(fetchMock)).toHaveLength(2);
    expect(generationHost?.querySelector('[data-image-ai-status="failed"]')).toBeTruthy();
    expect(generationHost?.textContent).toContain("Safe reconciled failure");
    expect(retryGenerationAsNewRequestButton()).toBeTruthy();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    expect(generationHost?.querySelector('[data-image-error-toast="true"]')).toBeNull();
    expect(retryGenerationAsNewRequestButton()).toBeNull();
    expect(resumeGenerationButton()).toBeNull();

    await activateTitleCoverWorkflow();
    expect(retryGenerationAsNewRequestButton()).toBeTruthy();
  });

  it("does not clear a visible Free Create error when hidden Title Cover succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = await mountGenerationPage({
      reconcileStatuses: [undefined, "succeeded"],
      postHandler: async () =>
        generationJsonResponse(
          { status: "in_progress", taskId: "task-title-cover-hidden-success", retryAfterMs: 2500 },
          202
        )
    });

    await activateTitleCoverWorkflow();
    await fillTitleCoverDraft("Hidden success title", "Hidden success copy");
    await clickTitleCoverGenerateButton();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    const freeInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-workbench-reference-input="true"]'
    );
    Object.defineProperty(freeInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["invalid"], "free-create-error.txt", { type: "text/plain" })]
    });
    await act(async () => {
      freeInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    const freeError = generationHost?.querySelector('[data-image-error-toast="true"]');
    expect(freeError).toBeTruthy();
    const freeErrorText = freeError?.textContent;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await settleGenerationPage();
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationHost?.querySelector('[data-image-error-toast="true"]')?.textContent).toBe(
      freeErrorText
    );
    expect(generationHost?.querySelector('[data-image-title-cover-result-empty="true"]')).toBeNull();
  });

  it("fences Title Cover retry by workflow and restores the frozen request after switching back", async () => {
    const fetchMock = await mountGenerationPage({
      postHandler: async (index, payload) =>
        index === 0
          ? generationJsonResponse(
              { message: "Title Cover frozen failure", code: "IMAGE_GENERATION_FAILED", retryable: true },
              500
            )
          : generationJsonResponse(
              createGenerationResponse(payload, { taskId: "task-title-cover-retry-fenced" })
            )
    });

    await activateTitleCoverWorkflow();
    await fillTitleCoverDraft("Frozen workflow title", "Frozen workflow copy");
    await clickTitleCoverGenerateButton();
    const firstBody = generationRequestBody(generationPostCalls(fetchMock)[0] ?? []);
    expect(retryGenerationAsNewRequestButton()).toBeTruthy();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    expect(retryGenerationAsNewRequestButton()).toBeNull();

    await activateTitleCoverWorkflow();
    expect(retryGenerationAsNewRequestButton()).toBeTruthy();
    await clickRetryGenerationAsNewRequestButton();
    expect(generationPostCalls(fetchMock)).toHaveLength(2);
    expect(generationRequestBody(generationPostCalls(fetchMock)[1] ?? [])).toBe(firstBody);
  });

  it("fences Title Cover Resume by workflow and restores it after switching back", async () => {
    vi.useFakeTimers();
    const fetchMock = await mountGenerationPage({
      reconcileStatuses: [],
      postHandler: async () => {
        throw new Error("Failed to fetch");
      }
    });

    await activateTitleCoverWorkflow();
    await fillTitleCoverDraft("Resumable workflow title", "Resumable workflow copy");
    await clickTitleCoverGenerateButton();
    await finishGenerationRecoveryAsUnresolved();
    expect(resumeGenerationButton()).toBeTruthy();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    expect(resumeGenerationButton()).toBeNull();

    await activateTitleCoverWorkflow();
    expect(resumeGenerationButton()).toBeTruthy();
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
  });

  it("keeps Title Cover reference memory isolated and reuses existing compression", async () => {
    mockReferenceCompressionBrowser({ width: 800, height: 600 });
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Free draft",
      models: [imageModel({ maxReferenceImages: 4 })]
    });
    const titleTab = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-workflow="title-cover"]'
    );

    await act(async () => {
      titleTab?.click();
      await Promise.resolve();
    });

    const referenceInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    const firstFile = new File(["first"], "person.png", { type: "image/png" });
    Object.defineProperty(referenceInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [firstFile]
    });
    await act(async () => {
      referenceInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();

    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-preview="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelectorAll('[data-image-title-cover-reference-input="true"]')
    ).toHaveLength(1);
    expect(generationHost?.textContent).toContain("person.png");

    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      configurable: true,
      value: () => "data:image/jpeg;base64,second"
    });
    const replacementInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    const secondFile = new File(["second"], "product.webp", { type: "image/webp" });
    Object.defineProperty(
      replacementInput ?? document.createElement("input"),
      "files",
      { configurable: true, value: [secondFile] }
    );
    await act(async () => {
      replacementInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();
    expect(generationHost?.textContent).toContain("product.webp");

    const originalTitle = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-original-title="true"]'
    );
    const mainCopy = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-title-cover-main-copy="true"]'
    );
    await act(async () => {
      if (originalTitle) setControlledFormValue(originalTitle, "Cover title");
      if (mainCopy) setControlledFormValue(mainCopy, "Exact copy");
      await Promise.resolve();
    });
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-title-cover-generate="true"]')
        ?.click();
      await Promise.resolve();
    });
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(
      JSON.parse(generationRequestBody(generationPostCalls(fetchMock)[0] ?? []))
    ).toMatchObject({ mode: "image-to-image" });

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>(
          '[data-image-workflow="free-create"]'
        )
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-preview="true"]')
    ).toBeNull();
    expect(
      generationHost?.querySelector('[data-image-reference-empty-upload="true"]')
    ).toBeTruthy();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>(
          '[data-image-workflow="title-cover"]'
        )
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-preview="true"]')
    ).toBeTruthy();
    expect(generationHost?.textContent).toContain("product.webp");
    const storedValues = Array.from(
      { length: window.localStorage.length + window.sessionStorage.length },
      (_, index) =>
        index < window.localStorage.length
          ? window.localStorage.getItem(window.localStorage.key(index) ?? "") ?? ""
          : window.sessionStorage.getItem(
              window.sessionStorage.key(index - window.localStorage.length) ?? ""
            ) ?? ""
    ).join("\n");
    expect(storedValues).not.toContain(referenceCompressionDataUrl);
    expect(storedValues).not.toContain("data:image/jpeg;base64,second");
    expect(generationPostCalls(fetchMock)).toHaveLength(1);

    while (
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-title-cover-reference-remove="true"]'
      )
    ) {
      await act(async () => {
        generationHost
          ?.querySelector<HTMLButtonElement>(
            '[data-image-title-cover-reference-remove="true"]'
          )
          ?.click();
        await Promise.resolve();
      });
    }
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-empty="true"]')
    ).toBeTruthy();
  });

  it("keeps the Title Cover fields and reference controls reachable in the mobile composition", async () => {
    mockReferenceCompressionBrowser({ width: 600, height: 900 });
    await mountGenerationPage({ mobile: true });
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });

    expect(
      generationHost?.querySelector('[data-image-title-cover-form="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-title-cover-original-title="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-title-cover-main-copy="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-title-cover-secondary-copy="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-title-cover-style="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-title-cover-typography-preset="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-title-cover-generate="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-title-cover-mobile-advanced-content="true"]')
    ).toBeNull();
    expect(
      generationHost?.querySelector('[data-image-title-cover-model="true"]')
    ).toBeNull();
    expect(
      generationHost?.querySelector('[data-image-title-cover-aspect="true"]')
    ).toBeNull();
    expect(
      generationHost?.querySelector('[data-image-title-cover-result-empty="true"]')
    ).toBeTruthy();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>(
          '[data-image-title-cover-mobile-advanced-toggle="true"]'
        )
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector('[data-image-title-cover-mobile-advanced-content="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-title-cover-model="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-title-cover-aspect="true"]')
    ).toBeTruthy();

    const input = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    Object.defineProperty(input ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["mobile"], "mobile-reference.jpg", { type: "image/jpeg" })]
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-preview="true"]')
    ).toBeTruthy();
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-title-cover-reference-remove="true"]')
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-empty="true"]')
    ).toBeTruthy();
  });

  it("keeps workflow-specific aspect/count defaults and Free Create state separate", async () => {
    await mountGenerationPage({
      initialPrompt: "Free draft",
      models: [imageModel({ maxReferenceImages: 4 })]
    });
    const freeAspect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-size="true"]'
    );
    expect(freeAspect?.value).toBe("auto");
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-generation-count-option="2"]')
        ?.click();
      if (freeAspect) {
        setControlledFormValue(freeAspect, "1:1");
      }
      await Promise.resolve();
    });

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const titleAspect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-title-cover-aspect="true"]'
    );
    expect(titleAspect?.value).toBe("16:9");
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="1"]'
      )?.getAttribute("data-image-generation-count-selected")
    ).toBe("true");
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-generation-count-option="4"]')
        ?.click();
      if (titleAspect) {
        setControlledFormValue(titleAspect, "9:16");
      }
      await Promise.resolve();
    });

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLSelectElement>('[data-image-workbench-size="true"]')
        ?.value
    ).toBe("1:1");
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="2"]'
      )?.getAttribute("data-image-generation-count-selected")
    ).toBe("true");
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLSelectElement>('[data-image-title-cover-aspect="true"]')
        ?.value
    ).toBe("9:16");
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="4"]'
      )?.getAttribute("data-image-generation-count-selected")
    ).toBe("true");
    expect(
      generationHost?.querySelectorAll('[data-image-generation-count-option]')
    ).toHaveLength(3);
  });

  it("clears only the Title Cover draft/reference semantics on New Creation", async () => {
    await mountGenerationPage({
      initialPrompt: "Free draft",
      models: [imageModel({ maxReferenceImages: 4 })]
    });
    const freeAspect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-size="true"]'
    );
    await act(async () => {
      if (freeAspect) setControlledFormValue(freeAspect, "1:1");
      await Promise.resolve();
    });
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const originalTitle = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-original-title="true"]'
    );
    const mainCopy = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-title-cover-main-copy="true"]'
    );
    const style = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-title-cover-style="true"]'
    );
    const aspect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-title-cover-aspect="true"]'
    );
    await act(async () => {
      if (originalTitle) setControlledFormValue(originalTitle, "Title");
      if (mainCopy) setControlledFormValue(mainCopy, "Copy");
      if (style) setControlledFormValue(style, "energetic-motion");
      if (aspect) setControlledFormValue(aspect, "1:1");
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-generation-count-option="4"]')
        ?.click();
      await Promise.resolve();
    });
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-new-drawing-btn="true"]')
        ?.click();
      await Promise.resolve();
    });
    const dialog = generationHost?.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    await act(async () => {
      const buttons = dialog?.querySelectorAll<HTMLButtonElement>("button");
      buttons?.[buttons.length - 1]?.click();
      await Promise.resolve();
    });
    expect(originalTitle?.value).toBe("");
    expect(mainCopy?.value).toBe("");
    expect(style?.value).toBe("minimal-modern");
    expect(aspect?.value).toBe("16:9");
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="1"]'
      )?.getAttribute("data-image-generation-count-selected")
    ).toBe("true");
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-empty="true"]')
    ).toBeTruthy();
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>('[data-image-workbench-prompt="true"]')
        ?.value
    ).toBe("Free draft");
    expect(
      generationHost?.querySelector<HTMLSelectElement>('[data-image-workbench-size="true"]')
        ?.value
    ).toBe("1:1");
  });

  it("clears the current Title Cover result context and starts a fresh projection", async () => {
    mockReferenceCompressionBrowser({ width: 800, height: 450 });
    await mountGenerationPage({ initialPrompt: "Free prompt remains" });
    await activateTitleCoverWorkflow();
    await fillTitleCoverDraft("First visual title", "First visual copy");

    const referenceInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    Object.defineProperty(referenceInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["reference"], "first-reference.png", { type: "image/png" })]
    });
    await act(async () => {
      referenceInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();
    await clickTitleCoverGenerateButton();

    expect(generationHost?.querySelector('[data-image-workbench-result-success="true"]')).toBeTruthy();
    const before = parseStoredImageSessions(
      window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))
    );
    const firstEntry = before?.sessions[0]?.entries[0];
    expect(firstEntry?.workflow).toBe("title-cover");

    await act(async () => {
      newDrawingButton()?.click();
      await Promise.resolve();
    });
    const dialog = generationHost?.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    await act(async () => {
      const buttons = dialog?.querySelectorAll<HTMLButtonElement>("button");
      buttons?.[buttons.length - 1]?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-title-cover-original-title="true"]'
      )?.value
    ).toBe("");
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-title-cover-main-copy="true"]'
      )?.value
    ).toBe("");
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-title-cover-secondary-copy="true"]'
      )?.value
    ).toBe("");
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-empty="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-title-cover-result-empty="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-workbench-result-success="true"]')
    ).toBeNull();
    expect(
      generationHost?.querySelector<HTMLSelectElement>(
        '[data-image-title-cover-aspect="true"]'
      )?.value
    ).toBe("16:9");
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="1"]'
      )?.getAttribute("data-image-generation-count-selected")
    ).toBe("true");

    const afterReset = parseStoredImageSessions(
      window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))
    );
    const resetSession = afterReset?.sessions.find(
      (session) => session.id === afterReset.activeSessionId
    );
    expect(resetSession?.entries).toHaveLength(1);
    expect(resetSession?.titleCoverCreationId).toBeTruthy();
    expect(resetSession?.titleCoverCreationId).not.toBe(firstEntry?.workflowContextId);

    await fillTitleCoverDraft("Second visual title", "Second visual copy");
    await clickTitleCoverGenerateButton();
    expect(
      generationHost?.querySelector('[data-image-workbench-result-success="true"]')
    ).toBeTruthy();

    const afterSecond = parseStoredImageSessions(
      window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))
    );
    const secondSession = afterSecond?.sessions.find(
      (session) => session.id === afterSecond.activeSessionId
    );
    expect(secondSession?.entries).toHaveLength(2);
    expect(secondSession?.entries[0]?.workflowContextId).not.toBe(
      secondSession?.titleCoverCreationId
    );
    expect(secondSession?.entries[1]?.workflowContextId).toBe(
      secondSession?.titleCoverCreationId
    );
  });

  it("treats a shared session containing only Title Cover entries as empty for Free Create", async () => {
    const sessionId = "title-only-shared-session";
    const titleContextId = "title-cover-context-one";
    const titleEntry = {
      ...createVersionEntry("succeeded", 901),
      id: "title-only-entry",
      workflow: "title-cover" as const,
      workflowContextId: titleContextId,
      imageSessionId: sessionId,
      result: createGenerationResponse(
        { prompt: "Title-only result", imageSessionId: sessionId },
        { taskId: "title-only-task" }
      )
    } satisfies ImageStreamEntry;
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("guest"),
      serializeImageSessionsForStorage(
        [
          {
            id: sessionId,
            title: "Title-only session",
            titleCoverCreationId: titleContextId,
            entries: [titleEntry]
          }
        ],
        sessionId
      )
    );

    await mountGenerationPage({
      initialPrompt: "",
      preserveStorage: true
    });
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    const before = parseStoredImageSessions(
      window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))
    );
    await act(async () => {
      newDrawingButton()?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    const after = parseStoredImageSessions(
      window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))
    );

    expect(after?.activeSessionId).toBe(before?.activeSessionId);
    expect(after?.sessions.map((session) => session.id)).toEqual(
      before?.sessions.map((session) => session.id)
    );
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("");
  });

  it("blocks Title Cover New Creation while generation is in flight", async () => {
    const response = createDeferred<Response>();
    await mountGenerationPage({
      postHandler: async () => response.promise
    });
    await activateTitleCoverWorkflow();
    await fillTitleCoverDraft("In-flight title", "In-flight copy");

    const generateButton = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-title-cover-generate="true"]'
    );
    await act(async () => {
      generateButton?.click();
      await Promise.resolve();
    });
    const newButton = newDrawingButton();
    expect(generateButton?.disabled).toBe(true);
    expect(newButton?.disabled).toBe(true);

    await act(async () => {
      newButton?.click();
      await Promise.resolve();
    });
    expect(generationHost?.querySelector('[role="dialog"]')).toBeNull();
    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-title-cover-original-title="true"]'
      )?.value
    ).toBe("In-flight title");

    await act(async () => {
      response.resolve(
        generationJsonResponse(
          createGenerationResponse({ prompt: "In-flight title", modelId: "image-model" })
        )
      );
      await response.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-workbench-result-success="true"]')).toBeTruthy();
  });

  it("fences stale Title Cover compression success after remove and reset", async () => {
    const { pendingImages, pendingReaders } =
      mockDeferredReferenceCompressionBrowser();
    await mountGenerationPage({ initialPrompt: "Free draft" });
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });

    const input = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    const firstFile = new File(["first"], "stale-remove.png", {
      type: "image/png"
    });
    Object.defineProperty(input ?? document.createElement("input"), "files", {
      configurable: true,
      value: [firstFile]
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      pendingReaders[0]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(pendingImages).toHaveLength(1);

    expect(input?.disabled).toBe(true);
    pendingImages[0]?.onload?.();
    await settleGenerationPage();
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-preview="true"]')
    ).toBeTruthy();
    expect(generationHost?.textContent).toContain("stale-remove.png");
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>(
          '[data-image-title-cover-reference-remove="true"]'
        )
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-empty="true"]')
    ).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-error-toast="true"]')).toBeNull();

    const title = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-original-title="true"]'
    );
    await act(async () => {
      if (title) setControlledFormValue(title, "Reset stale success");
      await Promise.resolve();
    });
    const finalInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    const finalFile = new File(["final"], "stale-reset.png", {
      type: "image/png"
    });
    Object.defineProperty(
      finalInput ?? document.createElement("input"),
      "files",
      { configurable: true, value: [finalFile] }
    );
    await act(async () => {
      finalInput?.dispatchEvent(new Event("change", { bubbles: true }));
      pendingReaders[1]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(pendingImages).toHaveLength(2);

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-new-drawing-btn="true"]')
        ?.click();
      await Promise.resolve();
    });
    const dialog = generationHost?.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    await act(async () => {
      const buttons = dialog?.querySelectorAll<HTMLButtonElement>("button");
      buttons?.[buttons.length - 1]?.click();
      await Promise.resolve();
    });
    pendingImages[1]?.onload?.();
    await settleGenerationPage();

    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-empty="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-preview="true"]')
    ).toBeNull();
    expect(generationHost?.querySelector('[data-image-error-toast="true"]')).toBeNull();
  });

  it("locks Title Cover replacement and remove while fencing a failure after reset", async () => {
    const { pendingImages, pendingReaders } =
      mockDeferredReferenceCompressionBrowser();
    await mountGenerationPage({
      initialPrompt: "Free draft",
      models: [imageModel({ maxReferenceImages: 4 })]
    });
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });

    const selectFile = async (name: string) => {
      const input = generationHost?.querySelector<HTMLInputElement>(
        '[data-image-title-cover-reference-input="true"]'
      );
      const file = new File([name], name, { type: "image/png" });
      Object.defineProperty(input ?? document.createElement("input"), "files", {
        configurable: true,
        value: [file]
      });
      await act(async () => {
        input?.dispatchEvent(new Event("change", { bubbles: true }));
        pendingReaders[pendingReaders.length - 1]?.onload?.();
        await Promise.resolve();
      });
      await settleGenerationPage();
    };

    await selectFile("current-reference-a.png");
    expect(pendingImages).toHaveLength(1);
    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-title-cover-reference-input="true"]'
      )?.disabled
    ).toBe(true);
    await selectFile("ignored-replacement-b.png");
    expect(pendingImages).toHaveLength(1);
    pendingImages[0]?.onload?.();
    await settleGenerationPage();
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-preview="true"]')
    ).toBeTruthy();
    expect(generationHost?.textContent).toContain("current-reference-a.png");
    expect(generationHost?.textContent).not.toContain("ignored-replacement-b.png");
    expect(generationHost?.querySelector('[data-image-error-toast="true"]')).toBeNull();

    await selectFile("failed-append.png");
    expect(pendingImages).toHaveLength(2);
    const removeWhilePreparing = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-title-cover-reference-remove="true"]'
    );
    expect(removeWhilePreparing?.disabled).toBe(true);
    await act(async () => {
      removeWhilePreparing?.click();
      await Promise.resolve();
    });
    pendingImages[1]?.onerror?.();
    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-error-toast="true"]')).toBeTruthy();
    expect(generationHost?.textContent).toContain("current-reference-a.png");
    expect(
      generationHost?.querySelectorAll('[data-image-reference-kind="title-cover"]')
    ).toHaveLength(1);
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-error-toast="true"] button')
        ?.click();
      await Promise.resolve();
    });

    const title = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-original-title="true"]'
    );
    await act(async () => {
      if (title) setControlledFormValue(title, "Reset stale failure");
      await Promise.resolve();
    });
    await selectFile("stale-reset-failure.png");
    expect(pendingImages).toHaveLength(3);
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-new-drawing-btn="true"]')
        ?.click();
      await Promise.resolve();
    });
    const dialog = generationHost?.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    await act(async () => {
      const buttons = dialog?.querySelectorAll<HTMLButtonElement>("button");
      buttons?.[buttons.length - 1]?.click();
      await Promise.resolve();
    });
    pendingImages[2]?.onerror?.();
    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-error-toast="true"]')).toBeNull();
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-empty="true"]')
    ).toBeTruthy();
  });

  it("keeps Free Create session/runtime unchanged through Title Cover New Creation", async () => {
    const freeReference = {
      dataUrl: "data:image/jpeg;base64,free-reference",
      mimeType: "image/jpeg",
      name: "free-reference.jpg",
      originalBytes: 120,
      compressedBytes: 80
    } as const;
    const initialResult = createGenerationResponse(
      { prompt: "Existing Free result", imageSessionTitle: "Existing Free result" },
      { taskId: "title-cover-new-creation-existing-result" }
    );
    await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "Free prompt remains",
      initialReferenceImage: freeReference,
      initialResult
    });
    const before = parseStoredImageSessions(
      window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))
    );
    expect(before).toBeTruthy();
    const beforeSessionIds = before?.sessions.map((session) => session.id) ?? [];
    const beforeEntryIds = before?.sessions.map((session) =>
      session.entries.map((entry) => entry.id)
    );
    const beforeActiveSessionId = before?.activeSessionId;

    await act(async () => {
      const freeAspect = generationHost?.querySelector<HTMLSelectElement>(
        '[data-image-workbench-size="true"]'
      );
      if (freeAspect) setControlledFormValue(freeAspect, "1:1");
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-generation-count-option="2"]')
        ?.click();
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const title = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-original-title="true"]'
    );
    const mainCopy = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-title-cover-main-copy="true"]'
    );
    await act(async () => {
      if (title) setControlledFormValue(title, "Title Cover draft");
      if (mainCopy) setControlledFormValue(mainCopy, "Cover copy");
      await Promise.resolve();
    });
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-new-drawing-btn="true"]')
        ?.click();
      await Promise.resolve();
    });
    const dialog = generationHost?.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    await act(async () => {
      const buttons = dialog?.querySelectorAll<HTMLButtonElement>("button");
      buttons?.[buttons.length - 1]?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-title-cover-original-title="true"]'
      )?.value
    ).toBe("");
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-empty="true"]')
    ).toBeTruthy();

    const after = parseStoredImageSessions(
      window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))
    );
    expect(after?.activeSessionId).toBe(beforeActiveSessionId);
    expect(after?.sessions.map((session) => session.id)).toEqual(beforeSessionIds);
    expect(after?.sessions.map((session) => session.entries.map((entry) => entry.id))).toEqual(
      beforeEntryIds
    );

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("Free prompt remains");
    expect(
      generationHost?.querySelector<HTMLImageElement>(
        '[data-image-workbench-reference] img'
      )?.getAttribute("src")
    ).toBe(freeReference.dataUrl);
    expect(
      generationHost?.querySelector<HTMLSelectElement>(
        '[data-image-workbench-size="true"]'
      )?.value
    ).toBe("1:1");
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="2"]'
      )?.getAttribute("data-image-generation-count-selected")
    ).toBe("true");
  });

  it("keeps a Free Create error through hidden Title Cover compression success and restores the reference", async () => {
    const { pendingImages, pendingReaders } =
      mockDeferredReferenceCompressionBrowser();
    await mountGenerationPage({ initialPrompt: "Free prompt remains" });

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });

    const titleInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    Object.defineProperty(titleInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["title"], "hidden-success.png", { type: "image/png" })]
    });
    await act(async () => {
      titleInput?.dispatchEvent(new Event("change", { bubbles: true }));
      pendingReaders[0]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(pendingImages).toHaveLength(1);

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    const freeInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-workbench-reference-input="true"]'
    );
    Object.defineProperty(freeInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["invalid"], "free-error.txt", { type: "text/plain" })]
    });
    await act(async () => {
      freeInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    const freeError = generationHost?.querySelector('[data-image-error-toast="true"]');
    expect(freeError).toBeTruthy();
    const freeErrorText = freeError?.textContent;

    await act(async () => {
      pendingImages[0]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(
      generationHost?.querySelector('[data-image-error-toast="true"]')?.textContent
    ).toBe(freeErrorText);

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-preview="true"]')
    ).toBeTruthy();
    expect(generationHost?.textContent).toContain("hidden-success.png");
  });

  it("does not surface hidden Title Cover compression failure in Free Create", async () => {
    const { pendingImages, pendingReaders } =
      mockDeferredReferenceCompressionBrowser();
    await mountGenerationPage({ initialPrompt: "Free prompt remains" });

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const titleInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    Object.defineProperty(titleInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["title"], "hidden-failure.png", { type: "image/png" })]
    });
    await act(async () => {
      titleInput?.dispatchEvent(new Event("change", { bubbles: true }));
      pendingReaders[0]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(pendingImages).toHaveLength(1);

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    await act(async () => {
      pendingImages[0]?.onerror?.();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(generationHost?.querySelector('[data-image-error-toast="true"]')).toBeNull();
  });

  it("shows a hidden Title Cover compression failure after returning to Title Cover", async () => {
    const { pendingImages, pendingReaders } =
      mockDeferredReferenceCompressionBrowser();
    await mountGenerationPage({ initialPrompt: "Free prompt remains" });

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const titleInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    Object.defineProperty(titleInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["title"], "return-failure.png", { type: "image/png" })]
    });
    await act(async () => {
      titleInput?.dispatchEvent(new Event("change", { bubbles: true }));
      pendingReaders[0]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
      pendingImages[0]?.onerror?.();
      await Promise.resolve();
    });
    await settleGenerationPage();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-empty="true"]')
    ).toBeTruthy();
    expect(generationHost?.textContent).toContain("Failed to compress reference image");
    expect(generationHost?.querySelector('[data-image-error-toast="true"]')).toBeNull();
  });

  it("restores a hidden Title Cover compression success when returning to Title Cover", async () => {
    const { pendingImages, pendingReaders } =
      mockDeferredReferenceCompressionBrowser();
    await mountGenerationPage({ initialPrompt: "Free prompt remains" });

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const titleInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    Object.defineProperty(titleInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["title"], "return-success.png", { type: "image/png" })]
    });
    await act(async () => {
      titleInput?.dispatchEvent(new Event("change", { bubbles: true }));
      pendingReaders[0]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(pendingImages).toHaveLength(1);

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
      pendingImages[0]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-preview="true"]')
    ).toBeTruthy();
    expect(generationHost?.textContent).toContain("return-success.png");
  });

  it("clears a blank Title Cover compression error without changing Free runtime", async () => {
    const { pendingImages, pendingReaders } =
      mockDeferredReferenceCompressionBrowser();
    const freeReference = {
      dataUrl: "data:image/jpeg;base64,f6-blank-reference",
      mimeType: "image/jpeg",
      name: "f6-blank-reference.jpg",
      originalBytes: 120,
      compressedBytes: 80
    } as const;
    const initialResult = createGenerationResponse(
      { prompt: "F6 blank existing result", imageSessionTitle: "F6 blank result" },
      { taskId: "f6-blank-existing-result" }
    );
    await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "F6 blank Free prompt",
      initialReferenceImage: freeReference,
      initialResult
    });
    const freeAspect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-size="true"]'
    );
    await act(async () => {
      if (freeAspect) setControlledFormValue(freeAspect, "1:1");
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-generation-count-option="2"]')
        ?.click();
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const before = parseStoredImageSessions(
      window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))
    );
    const beforeSessionIds = before?.sessions.map((session) => session.id) ?? [];
    const beforeEntryIds = before?.sessions.map((session) =>
      session.entries.map((entry) => entry.id)
    );
    const beforeActiveSessionId = before?.activeSessionId;

    const titleInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    Object.defineProperty(titleInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [new File(["title"], "f6-blank-failure.png", { type: "image/png" })]
    });
    await act(async () => {
      titleInput?.dispatchEvent(new Event("change", { bubbles: true }));
      pendingReaders[0]?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();
    pendingImages[0]?.onerror?.();
    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-error-toast="true"]')).toBeTruthy();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-new-drawing-btn="true"]')
        ?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-error-toast="true"]')).toBeNull();
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-empty="true"]')
    ).toBeTruthy();

    const after = parseStoredImageSessions(
      window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))
    );
    expect(after?.activeSessionId).toBe(beforeActiveSessionId);
    expect(after?.sessions.map((session) => session.id)).toEqual(beforeSessionIds);
    expect(after?.sessions.map((session) => session.entries.map((entry) => entry.id))).toEqual(
      beforeEntryIds
    );

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>('[data-image-workbench-prompt="true"]')
        ?.value
    ).toBe("F6 blank Free prompt");
    expect(
      generationHost?.querySelector<HTMLImageElement>('[data-image-workbench-reference] img')
        ?.getAttribute("src")
    ).toBe(freeReference.dataUrl);
    expect(
      generationHost?.querySelector<HTMLSelectElement>('[data-image-workbench-size="true"]')
        ?.value
    ).toBe("1:1");
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="2"]'
      )?.getAttribute("data-image-generation-count-selected")
    ).toBe("true");
  });

  it("clears a Title Cover error after confirming New Creation without changing Free session identity", async () => {
    const freeReference = {
      dataUrl: "data:image/jpeg;base64,f6-confirm-reference",
      mimeType: "image/jpeg",
      name: "f6-confirm-reference.jpg",
      originalBytes: 120,
      compressedBytes: 80
    } as const;
    const initialResult = createGenerationResponse(
      { prompt: "F6 confirm existing result", imageSessionTitle: "F6 confirm result" },
      { taskId: "f6-confirm-existing-result" }
    );
    await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "F6 confirm Free prompt",
      initialReferenceImage: freeReference,
      initialResult
    });
    const freeAspect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-size="true"]'
    );
    await act(async () => {
      if (freeAspect) setControlledFormValue(freeAspect, "3:2");
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-generation-count-option="4"]')
        ?.click();
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const before = parseStoredImageSessions(
      window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))
    );
    const beforeSessionIds = before?.sessions.map((session) => session.id) ?? [];
    const beforeEntryIds = before?.sessions.map((session) =>
      session.entries.map((entry) => entry.id)
    );
    const beforeActiveSessionId = before?.activeSessionId;

    const title = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-original-title="true"]'
    );
    await act(async () => {
      if (title) setControlledFormValue(title, "F6 confirm draft");
      await Promise.resolve();
    });
    const titleReferenceInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    Object.defineProperty(
      titleReferenceInput ?? document.createElement("input"),
      "files",
      {
        configurable: true,
        value: [new File(["invalid"], "f6-confirm-error.txt", { type: "text/plain" })]
      }
    );
    await act(async () => {
      titleReferenceInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(generationHost?.querySelector('[data-image-error-toast="true"]')).toBeTruthy();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-new-drawing-btn="true"]')
        ?.click();
      await Promise.resolve();
    });
    const dialog = generationHost?.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    await act(async () => {
      const buttons = dialog?.querySelectorAll<HTMLButtonElement>("button");
      buttons?.[buttons.length - 1]?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(generationHost?.querySelector('[data-image-error-toast="true"]')).toBeNull();
    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-title-cover-original-title="true"]'
      )?.value
    ).toBe("");
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-empty="true"]')
    ).toBeTruthy();
    expect(generationHost?.querySelector('[role="dialog"]')).toBeNull();

    const after = parseStoredImageSessions(
      window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))
    );
    expect(after?.activeSessionId).toBe(beforeActiveSessionId);
    expect(after?.sessions.map((session) => session.id)).toEqual(beforeSessionIds);
    expect(after?.sessions.map((session) => session.entries.map((entry) => entry.id))).toEqual(
      beforeEntryIds
    );

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>('[data-image-workbench-prompt="true"]')
        ?.value
    ).toBe("F6 confirm Free prompt");
    expect(
      generationHost?.querySelector<HTMLImageElement>('[data-image-workbench-reference] img')
        ?.getAttribute("src")
    ).toBe(freeReference.dataUrl);
    expect(
      generationHost?.querySelector<HTMLSelectElement>('[data-image-workbench-size="true"]')
        ?.value
    ).toBe("3:2");
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="4"]'
      )?.getAttribute("data-image-generation-count-selected")
    ).toBe("true");
  });

  it("does not use the hidden Free Create prompt for Title Cover Auto size", async () => {
    await mountGenerationPage({ initialPrompt: "Make a clear 9:16 portrait poster" });
    expect(generationHost?.textContent).toContain("720x1280");

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const titleAspect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-title-cover-aspect="true"]'
    );
    await act(async () => {
      if (titleAspect) setControlledFormValue(titleAspect, "auto");
      await Promise.resolve();
    });
    expect(generationHost?.textContent).toContain("1024x1024");
    expect(generationHost?.textContent).not.toContain("720x1280");

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="free-create"]')
        ?.click();
      await Promise.resolve();
    });
    expect(generationHost?.textContent).toContain("720x1280");
  });

  it("renders the unified Creator layout without a legacy sidebar or Quick transcript", () => {
    const html = renderImageWorkspace();

    expect(html).toContain('data-image-workspace-root="true"');
    expect(html).toContain('data-image-workspace-grid="true"');
    expect(html).toContain('data-image-main-scroll="true"');
    expect(html).not.toContain('md:rounded-t-2xl');
    expect(html).not.toContain('md:border md:border-slate-200');
    expect(html).toContain('data-image-empty-state="true"');
    expect(html).toContain('data-image-creator-main="left-input-right-result"');
    expect(html).toContain('data-image-creator-input="true"');
    expect(html).toContain('data-image-creator-result="true"');
    expect(html).not.toContain('data-image-secondary-sidebar="true"');
    expect(html).not.toContain('data-image-inspiration-carousel="true"');
    expect(html).not.toContain('data-image-inspiration-grid="true"');
    expect(html).not.toContain('data-image-mobile-inspiration-grid="true"');
    expect(html).toContain('data-image-new-drawing-btn="true"');
    expect(html).toContain('data-image-composer-prompt="true"');
    expect(html).toContain('<form');
    expect(html).toContain('data-image-drag-upload="reference-image"');
    expect(html).toContain('data-image-drag-uses-existing-validation="true"');
    expect(html).toContain('data-image-workbench-model="true"');
    expect(html).toContain('data-image-workbench-size="true"');
    expect(html).toContain('data-image-generation-count-picker="true"');
    expect(html).toContain('data-image-generate-button="true"');
    expect(html).toContain('data-image-generate-request-flow="unchanged"');
    expect(html).toContain("Reference image");
    expect(html).toContain("Estimated cost: 2");
    expect(html).toContain("Current balance: 20");
    expect(html).toContain("Generate image");
    expect(html).toContain("send-horizontal");
    expect(html).toContain("<select");
    expect(html).not.toContain("View tasks");
    expect(html).not.toContain("View assets");
    expect(html).toContain("PNG, JPG, or WebP up to 5 MB");
    expect(html).not.toContain("Multimodal workspace");
    expect(html).not.toContain(
      "Generate images from a text prompt with an image-capable model."
    );
    expect(html).not.toContain(
      "Credits are deducted only after successful image generation."
    );
    expect(html).not.toContain("Generation mode");
    expect(html).not.toContain("Template / scene");
  });

  it("sanitizes legacy reference bytes and rewrites the current account-scoped session", async () => {
    const legacyDataUrl = "data:image/jpeg;base64,LEGACY_ACCOUNT_REFERENCE";
    const storageKey = getImageSessionsStorageKey("user:workspace-user-a");
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        activeSessionId: "legacy-account-session",
        firstPageLoadedAt: "2026-07-15T00:00:00.000Z",
        backendHistoryDismissed: false,
        sessions: [
          {
            id: "legacy-account-session",
            title: "Legacy account session",
            entries: [
              {
                id: "legacy-account-entry",
                prompt: "Preserve this historical prompt",
                modelName: "Image Model",
                aspectRatio: "1:1",
                mode: "image-to-image",
                referenceImage: {
                  dataUrl: legacyDataUrl,
                  name: "account-reference.jpg"
                },
                status: "loading",
                result: null,
                error: null
              }
            ]
          }
        ]
      })
    );

    const fetchMock = await mountGenerationPage({
      workspaceAuth: true,
      mode: "workspace",
      preserveStorage: true
    });
    await settleGenerationPage();

    const rewritten = window.sessionStorage.getItem(storageKey) ?? "";
    expect(rewritten).not.toContain(legacyDataUrl);
    expect(rewritten).toContain("account-reference.jpg");
    expect(rewritten).toContain("Preserve this historical prompt");
    const parsed = parseStoredImageSessions(rewritten);
    expect(parsed?.sessions[0]?.entries[0]).toMatchObject({
      referenceImage: null,
      referenceImageMetadata: { name: "account-reference.jpg" },
      mode: "image-to-image"
    });
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("persists ordered reference metadata without raw multi-reference data", () => {
    const entry: ImageStreamEntry = {
      id: "multi-reference-entry",
      prompt: "Use two references",
      modelName: "Image Model",
      aspectRatio: "auto",
      mode: "image-to-image",
      referenceImages: [
        { dataUrl: "data:image/png;base64,FIRST", name: "first.png" },
        { dataUrl: "data:image/jpeg;base64,SECOND", name: "second.jpg" }
      ],
      referenceImage: null,
      status: "loading",
      result: null,
      error: null
    };
    const serialized = serializeImageSessionsForStorage(
      [{ id: "session", title: "Session", entries: [entry] }],
      "session"
    );
    expect(serialized).not.toContain("data:image/");
    const parsed = parseStoredImageSessions(serialized)?.sessions[0]?.entries[0];
    expect(parsed?.referenceImagesMetadata).toEqual([
      { name: "first.png" },
      { name: "second.jpg" }
    ]);
    expect(parsed?.referenceImageMetadata).toEqual({ name: "first.png" });
    expect(parsed?.referenceImages).toBeUndefined();
  });

  it("reads ordered backend referenceImages before the scalar compatibility field", () => {
    const task = createReconcileTask(
      "succeeded",
      { prompt: "Ordered backend history" },
      1
    );
    task.input = {
      ...task.input,
      mode: "image-to-image",
      referenceImages: [{ name: "A.png" }, { name: "B.jpg" }],
      referenceImage: { name: "legacy-duplicate.png" }
    };
    const entry = taskToImageStreamEntry(
      task,
      new Map([["image-model", imageModel()]]),
      createTranslator("en-US")
    );
    expect(entry.referenceImagesMetadata).toEqual([
      { name: "A.png" },
      { name: "B.jpg" }
    ]);
    expect(entry.referenceImageMetadata).toEqual({ name: "A.png" });
  });

  it("restores account-scoped Creator history and drops legacy global storage", async () => {
    const scopedSession = {
      id: "scoped-history-session",
      title: "Scoped history",
      entries: [
        {
          id: "scoped-history-entry",
          prompt: "Scoped history prompt",
          modelName: "Image Model",
          modelId: "image-model",
          aspectRatio: "1:1" as const,
          mode: "text-to-image" as const,
          referenceImage: null,
          status: "succeeded" as const,
          result: null,
          error: null
        }
      ]
    };
    const accountSessionKey = getImageSessionsStorageKey("user:workspace-user-a");
    const accountDismissedKey = getDismissedImageSessionsStorageKey(
      "user:workspace-user-a"
    );
    window.sessionStorage.setItem(
      accountSessionKey,
      serializeImageSessionsForStorage([scopedSession], scopedSession.id)
    );
    window.sessionStorage.setItem(
      imageSessionsStorageKey,
      serializeImageSessionsForStorage(
        [{ ...scopedSession, id: "legacy-global-session" }],
        "legacy-global-session"
      )
    );
    window.localStorage.setItem(
      accountDismissedKey,
      serializeDismissedImageSessionIds([])
    );
    window.localStorage.setItem(
      dismissedImageSessionsStorageKey,
      serializeDismissedImageSessionIds(["legacy-dismissed-session"])
    );

    await mountGenerationPage({
      workspaceAuth: true,
      mode: "workspace",
      preserveStorage: true
    });
    await settleGenerationPage();

    expect(generationHost?.querySelector('[data-image-creator-history="true"]')).toBeTruthy();
    expect(window.localStorage.getItem(accountDismissedKey)).toBe(JSON.stringify([]));
    expect(window.localStorage.getItem(dismissedImageSessionsStorageKey)).toBeNull();
    expect(window.localStorage.getItem(getDismissedImageSessionsStorageKey("user:workspace-user-b"))).toBeNull();
    expect(window.sessionStorage.getItem(imageSessionsStorageKey)).toBeNull();
    expect(window.sessionStorage.getItem(accountSessionKey)).toContain("scoped-history-session");
  });

  it("restores the same guest-scoped local session that image history reads", async () => {
    const guestSession = {
      id: "guest-shared-session",
      title: "Guest shared history",
      entries: [
        {
          id: "guest-shared-entry",
          prompt: "Guest shared prompt",
          modelName: "Image Model",
          modelId: "image-model",
          aspectRatio: "1:1" as const,
          mode: "text-to-image" as const,
          referenceImage: null,
          status: "succeeded" as const,
          result: null,
          error: null
        }
      ]
    };
    const guestKey = getImageSessionsStorageKey("guest");
    window.sessionStorage.setItem(
      guestKey,
      serializeImageSessionsForStorage([guestSession], guestSession.id)
    );

    await mountGenerationPage({
      initialToken: null,
      preserveStorage: true,
      mode: "workspace"
    });
    await settleGenerationPage();

    expect(generationHost?.querySelector('[data-image-creator-history="true"]')).toBeTruthy();
    expect(parseStoredImageSessions(window.sessionStorage.getItem(guestKey))?.sessions[0]?.id).toBe(
      "guest-shared-session"
    );
  });

  it("keeps authenticated user-missing image history memory-only without touching guest storage", async () => {
    const guestSession = {
      id: "token-user-missing-main-session",
      title: "Guest private marker",
      entries: [
        {
          id: "token-user-missing-main-entry",
          prompt: "Guest private prompt",
          modelName: "Image Model",
          modelId: "image-model",
          aspectRatio: "1:1" as const,
          mode: "text-to-image" as const,
          referenceImage: null,
          status: "succeeded" as const,
          result: null,
          error: null
        }
      ]
    };
    const guestSessionsRaw = serializeImageSessionsForStorage(
      [guestSession],
      guestSession.id
    );
    const guestDismissedRaw = serializeDismissedImageSessionIds([guestSession.id]);
    const backendTask = createGenerationResponse(
      {
        prompt: "Account A backend marker",
        imageSessionId: guestSession.id,
        imageSessionTitle: "Account A backend marker"
      },
      {
        taskId: "token-user-missing-main-backend-task",
        imageUrl: "https://cdn.example.test/account-a-backend.png"
      }
    ).task;

    window.sessionStorage.setItem(getImageSessionsStorageKey("guest"), guestSessionsRaw);
    window.localStorage.setItem(
      getDismissedImageSessionsStorageKey("guest"),
      guestDismissedRaw
    );

    const fetchMock = await mountGenerationPage({
      workspaceAuth: true,
      workspaceAuthStoredUser: null,
      mode: "workspace",
      preserveStorage: true,
      backendHistoryTasks: [backendTask]
    });
    await settleGenerationPage();

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          generationUrl(input).searchParams.get("limit") === "100" &&
          new Headers(init?.headers).get("Authorization") === "Bearer token-a"
      )
    ).toBe(true);
    expect(generationHost?.querySelector('[data-image-creator-history="true"]')).toBeTruthy();
    expect(generationHost?.textContent).not.toContain("Guest private marker");
    expect(window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))).toBe(
      guestSessionsRaw
    );
    expect(window.localStorage.getItem(getDismissedImageSessionsStorageKey("guest"))).toBe(
      guestDismissedRaw
    );
    expect(
      [
        ...Array.from(
          { length: window.sessionStorage.length },
          (_, index) => window.sessionStorage.key(index) ?? ""
        ),
        ...Array.from(
          { length: window.localStorage.length },
          (_, index) => window.localStorage.key(index) ?? ""
        )
      ].some(
        (key) => key.includes("token-a") || key.includes("authenticated-unknown")
      )
    ).toBe(false);
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generate-button="true"], [data-image-workbench-generate="true"]'
      )
    ).toBeTruthy();
  });

  it("stores only a versioned account-scoped prompt draft and scalar image scroll", () => {
    window.sessionStorage.clear();

    writeImagePromptDraft("user:workspace-user-a", "A private draft");
    writeImagePromptDraft("user:workspace-user-b", "B private draft");
    writeImageScrollTop("user:workspace-user-a", "session-a", 240);
    writeImageScrollTop("user:workspace-user-a", "session-b", 80);

    const draftKey = getImagePromptDraftStorageKey("user:workspace-user-a");
    expect(draftKey).toBe(
      `${imagePromptDraftStorageKey}:account-user%3Aworkspace-user-a`
    );
    expect(JSON.parse(window.sessionStorage.getItem(draftKey ?? "") ?? "{}")).toMatchObject({
      version: 1,
      identity: "user:workspace-user-a",
      prompt: "A private draft"
    });
    expect(readImagePromptDraft("user:workspace-user-a")).toBe("A private draft");
    expect(readImagePromptDraft("user:workspace-user-b")).toBe("B private draft");
    expect(readImagePromptDraft("guest")).toBe("");
    expect(readImageScrollTop("user:workspace-user-a", "session-a")).toBe(240);
    expect(readImageScrollTop("user:workspace-user-a", "session-b")).toBe(80);
    expect(readImageScrollTop("user:workspace-user-b", "session-a")).toBeNull();
    expect(getImageScrollStorageKey("user:workspace-user-a", "session-b")).not.toBe(
      getImageScrollStorageKey("user:workspace-user-a", "session-a")
    );
    expect(getImageScrollStorageKey(null, "session-a")).toBeNull();

    const storedKeys = Array.from(
      { length: window.sessionStorage.length },
      (_, index) => window.sessionStorage.key(index) ?? ""
    );
    expect(storedKeys.join("\n")).not.toContain("token");
    expect(storedKeys.join("\n")).not.toContain("data:image");
  });

  it("keeps authenticated user-missing prompt drafts memory-only without adopting guest", async () => {
    window.sessionStorage.clear();
    writeImagePromptDraft("guest", "Guest draft must stay private");
    writeImagePromptDraft("user:workspace-user-a", "Old A draft");

    await mountGenerationPage({
      workspaceAuth: true,
      workspaceAuthStoredUser: null,
      initialPrompt: "",
      preserveStorage: true
    });
    await settleGenerationPage();

    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-composer-prompt="true"], [data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("");
    expect(readImagePromptDraft("guest")).toBe("Guest draft must stay private");
    expect(getImagePromptDraftStorageKey(null)).toBeNull();

    await setGenerationPrompt("Keep this memory draft during hydration");
    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-workspace-auth-login-a="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-composer-prompt="true"], [data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("Keep this memory draft during hydration");
    expect(readImagePromptDraft("user:workspace-user-a")).toBe(
      "Keep this memory draft during hydration"
    );

    await unmountGenerationRoute();
    await mountGenerationPage({
      workspaceAuth: true,
      initialPrompt: "",
      preserveStorage: true
    });
    await settleGenerationPage();
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-composer-prompt="true"], [data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("Keep this memory draft during hydration");
    expect(readImagePromptDraft("user:workspace-user-a")).toBe(
      "Keep this memory draft during hydration"
    );
  });

  it("preserves the mounted Title Cover draft/reference during same-account hydration", async () => {
    mockReferenceCompressionBrowser();
    await mountGenerationPage({
      workspaceAuth: true,
      workspaceAuthStoredUser: null,
      initialPrompt: "",
      preserveStorage: true
    });

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const title = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-original-title="true"]'
    );
    const copy = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-title-cover-main-copy="true"]'
    );
    await act(async () => {
      if (title) setControlledFormValue(title, "Hydrated title");
      if (copy) setControlledFormValue(copy, "Hydrated copy");
      await Promise.resolve();
    });
    const input = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    const reference = new File(["hydrated"], "hydrated-reference.png", {
      type: "image/png"
    });
    Object.defineProperty(input ?? document.createElement("input"), "files", {
      configurable: true,
      value: [reference]
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-preview="true"]')
    ).toBeTruthy();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-workspace-auth-login-a="true"]')
        ?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-title-cover-original-title="true"]'
      )?.value
    ).toBe("Hydrated title");
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-title-cover-main-copy="true"]'
      )?.value
    ).toBe("Hydrated copy");
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-preview="true"]')
    ).toBeTruthy();
    const storedValues = [
      ...Array.from(
        { length: window.localStorage.length },
        (_, index) => window.localStorage.getItem(window.localStorage.key(index) ?? "") ?? ""
      ),
      ...Array.from(
        { length: window.sessionStorage.length },
        (_, index) => window.sessionStorage.getItem(window.sessionStorage.key(index) ?? "") ?? ""
      )
    ].join("\n");
    expect(storedValues).not.toContain("hydrated-reference.png");
    expect(storedValues).not.toContain("data:image");
  });

  it("clears the mounted Title Cover draft/reference on an actual account switch", async () => {
    mockReferenceCompressionBrowser();
    await mountGenerationPage({
      workspaceAuth: true,
      initialPrompt: "",
      preserveStorage: false
    });
    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
        ?.click();
      await Promise.resolve();
    });
    const title = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-original-title="true"]'
    );
    const input = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-reference-input="true"]'
    );
    await act(async () => {
      if (title) setControlledFormValue(title, "Account A title");
      await Promise.resolve();
    });
    const reference = new File(["account-a"], "account-a-reference.png", {
      type: "image/png"
    });
    Object.defineProperty(input ?? document.createElement("input"), "files", {
      configurable: true,
      value: [reference]
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-preview="true"]')
    ).toBeTruthy();

    await act(async () => {
      generationHost
        ?.querySelector<HTMLButtonElement>('[data-workspace-auth-switch="true"]')
        ?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-title-cover-original-title="true"]'
      )?.value
    ).toBe("");
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-empty="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-title-cover-reference-preview="true"]')
    ).toBeNull();
    const storedValues = [
      ...Array.from(
        { length: window.localStorage.length },
        (_, index) => window.localStorage.getItem(window.localStorage.key(index) ?? "") ?? ""
      ),
      ...Array.from(
        { length: window.sessionStorage.length },
        (_, index) => window.sessionStorage.getItem(window.sessionStorage.key(index) ?? "") ?? ""
      )
    ].join("\n");
    expect(storedValues).not.toContain("account-a-reference.png");
    expect(storedValues).not.toContain("data:image");
  });

  it("fences prompt draft clearing by identity, value, and revision", () => {
    const base = {
      currentIdentity: "user:workspace-user-a",
      loadedDraftIdentity: "user:workspace-user-a",
      persistenceIdentityAtSubmit: "user:workspace-user-a",
      currentPrompt: "same draft",
      draftAtSubmit: "same draft",
      currentPromptRevision: 4,
      promptRevisionAtSubmit: 4
    };

    expect(shouldClearImagePromptDraftAfterSubmit(base)).toBe(true);
    expect(
      shouldClearImagePromptDraftAfterSubmit({
        ...base,
        currentPrompt: "newer draft"
      })
    ).toBe(false);
    expect(
      shouldClearImagePromptDraftAfterSubmit({
        ...base,
        currentIdentity: "user:workspace-user-b"
      })
    ).toBe(false);
    expect(
      shouldClearImagePromptDraftAfterSubmit({
        ...base,
        currentPromptRevision: 5
      })
    ).toBe(false);
    expect(
      shouldClearImagePromptDraftAfterSubmit({
        ...base,
        persistenceIdentityAtSubmit: null,
        currentIdentity: null,
        loadedDraftIdentity: null
      })
    ).toBe(false);
  });

  it("clamps a restored Image scroll scalar without forcing a missing position", () => {
    expect(clampImageScrollTop(900, 900, 400)).toBe(500);
    expect(clampImageScrollTop(-1, 900, 400)).toBeNull();
    expect(clampImageScrollTop(null, 900, 400)).toBeNull();
    expect(clampImageScrollTop(120, 300, 500)).toBe(0);
  });

  it("keeps the empty Creator reference entry compact", () => {
    const html = renderImageWorkspace({}, "zh-CN");

    expect(html).toContain('data-image-workbench-reference="true"');
    expect(html).toContain('data-image-drag-upload="reference-image"');
    expect(html).toContain('data-image-reference-empty-upload="true"');
    expect(html).not.toContain('data-image-workbench-reference-remove="true"');
    expect(html.match(/添加参考图/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html).toContain("描述你想生成的画面…");
  });

  it("renders one compact reference thumbnail with removal", () => {
    const html = renderImageWorkspace({
      initialReferenceImage: {
        dataUrl: "data:image/jpeg;base64,cm9vbQ==",
        mimeType: "image/jpeg",
        name: "room.jpg",
        originalBytes: 2048,
        compressedBytes: 1024
      }
    });

    expect(html).toContain('data-reference-image-preview="true"');
    expect(html.match(/data-image-workbench-reference-remove="true"/g)).toHaveLength(1);
    expect(html).toContain("Add reference");
    expect(html).not.toContain("Replace reference");
    expect(html).not.toContain('data-image-reference-empty-upload="true"');
    expect(html.indexOf('data-image-composer-prompt="true"')).toBeLessThan(
      html.indexOf('data-image-workbench-reference="true"')
    );
  });

  it("keeps reference, model, aspect, count, and generate in the compact Creator surface", () => {
    const html = renderImageWorkspace({}, "zh-CN");
    expect(html).toContain('data-image-workbench-reference="true"');
    expect(html).toContain('data-image-workbench-model="true"');
    expect(html).toContain('data-image-workbench-size="true"');
    expect(html).toContain('data-image-generation-count-picker="true"');
    expect(html).toContain('data-image-workbench-generate="true"');
    expect(html).not.toContain('data-image-mobile-model-control="true"');
    expect(imagePageSource).toContain("multiple={activeReferenceLimit > 1}");
  });

  it("calculates the per-generation cost from the selected model and count", () => {
    const html = renderImageWorkspace(
      { initialModels: [imageModel({ creditCost: 3 })] },
      "zh-CN"
    );

    expect(html).toContain('data-image-workbench-cost="true"');
    expect(html).toContain("预计消耗: 3");
    expect(imagePageSource).toContain(
      "const generationCount: AiGenerationCount = count;"
    );
    expect(imagePageSource).toContain("(selectedModel?.creditCost ?? 0) * generationCount");
    expect(imagePageSource).toContain("aiGenerationCounts.map");
  });

  it("submits the canonical image model slug and requires image capability", () => {
    expect(imagePageSource).toContain("requestedModelId = selectedModel.slug;");
    expect(imagePageSource).toContain("modelId: selectedModel.slug");
    expect(imagePageSource).toContain("isImageCapableModel(model)");
  });

  it("resolves a duplicate legacy image model by slug and submits that slug", async () => {
    const modelA = imageModel({
      id: "model_gpt_image_two",
      slug: "gpt-image-2",
      modelId: "gpt-image-2",
      displayName: "GPT Image 2",
      creditCost: 2
    });
    const modelB = imageModel({
      id: "model_image_two",
      slug: "image2",
      modelId: "gpt-image-2",
      displayName: "Image 2 Alias",
      creditCost: 7,
      sortOrder: 1
    });

    expect(resolveImageSelectableModel("image2", [modelA, modelB])).toBe(modelB);

    const fetchMock = await mountGenerationPage({
      modelQuery: "image2",
      models: [modelA, modelB]
    });
    expect(
      Array.from(
        generationHost?.querySelectorAll('[data-image-model-current="true"]') ?? []
      ).some((element) => element.textContent?.includes("Image 2 Alias"))
    ).toBe(true);

    await clickGenerationButton();

    expect(
      JSON.parse(generationRequestBody(generationPostCalls(fetchMock)[0] ?? []))
    ).toMatchObject({ modelId: "image2" });
  });

  it("uses the shared Image, Video, and Canvas mobile creation switcher without PPT", () => {
    const html = renderImageWorkspace({}, "zh-CN");

    expect(html).toContain('data-creation-surface-active="image"');
    expect(html).toContain('data-creation-surface-option="image"');
    expect(html).toContain('data-creation-surface-option="video"');
    expect(html).toContain('data-creation-surface-option="canvas"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/video"');
    expect(html).toContain('href="/canvas"');
    expect(html).not.toContain('data-creation-surface-option="ppt"');
    expect(html).toContain('data-image-mobile-inspiration-disabled="true"');
    expect(html).not.toContain('data-image-mobile-inspiration-disabled="true" href=');
  });

  it("provides mobile history and new-session actions without a permanent sidebar", () => {
    const html = renderImageWorkspace({}, "zh-CN");

    expect(html).toContain('data-image-mobile-history-button="true"');
    expect(imagePageSource).toContain('href="/image/history"');
    expect(imagePageSource).not.toContain("isMobileHistoryOpen");
    expect(imagePageSource).not.toContain('data-image-mobile-history-drawer="true"');
    expect(html).toContain('data-image-mobile-new-drawing="true"');
    expect(html).toContain('data-image-new-drawing-btn="true"');
    expect(html).not.toContain('data-image-secondary-sidebar="true"');
  });

  it("places the Desktop New Creation utility before the existing history action", () => {
    const html = renderImageWorkspace({}, "zh-CN");

    expect(html).toContain('data-image-desktop-utility-actions="true"');
    expect(html).toContain('data-image-desktop-new-drawing="true"');
    expect(html).toContain("新建创作");
    expect(html).toContain('data-image-creator-history="true"');
    expect(html).toContain('href="/image/history"');
    expect(html).toContain("hidden shrink-0 items-center gap-1 md:flex");
    expect(
      html.indexOf('data-image-desktop-new-drawing="true"')
    ).toBeLessThan(html.indexOf('data-image-creator-history="true"'));
  });

  it("keeps the Desktop utility action hidden in the existing Mobile layout", async () => {
    await mountGenerationPage({ mobile: true, initialPrompt: "" });

    const desktopNewDrawing = generationHost?.querySelector<HTMLElement>(
      '[data-image-desktop-new-drawing="true"]'
    );
    expect(desktopNewDrawing?.parentElement?.className).toContain("hidden");
    expect(
      generationHost?.querySelectorAll('[data-image-mobile-new-drawing="true"]')
    ).toHaveLength(1);
  });

  it("defaults to quick mode and safely falls back for an invalid URL mode", () => {
    expect(parseImageCreationMode(null)).toBe("quick");
    expect(parseImageCreationMode("quick")).toBe("quick");
    expect(parseImageCreationMode("workspace")).toBe("workspace");
    expect(parseImageCreationMode("unsupported")).toBe("quick");

    const html = renderImageWorkspaceWithMode("unsupported");

    expect(html).toContain('data-image-creation-mode="quick"');
    expect(html).toContain('data-image-creator-workspace="true"');
    expect(html).not.toContain('data-image-quick-inspiration="true"');
  });

  it("renders the workspace mode as one editor and one real result area", () => {
    const html = renderImageWorkspaceWithMode("workspace", {
      initialPrompt: "keep this prompt"
    });

    expect(html).toContain('data-image-creation-mode="workspace"');
    expect(html).toContain('data-image-creation-workspace="true"');
    expect(html).toContain("Free create");
    expect(html).toContain("Count");
    expect(html).toContain('data-image-workbench-editor="true"');
    expect(html).toContain('data-image-workbench-result="true"');
    expect(html).toContain('data-image-workbench-result-empty="true"');
    expect(html).not.toContain('data-image-inspiration-carousel="true"');
    expect(html).not.toContain('data-image-prompt-card-thumbnails="true"');
    expect(html).not.toContain('data-use-inspiration-prompt="true"');
    expect(html.match(/data-image-workbench-prompt="true"/g)).toHaveLength(1);
    expect(html.match(/data-image-workbench-generate="true"/g)).toHaveLength(1);
    expect(html).toContain("keep this prompt");
    expect(html).not.toContain("Publish platform");
    expect(html).not.toContain("方案");
  });

  it("maps loading, success, and failure to the real workspace result state", () => {
    const loadingHtml = renderImageWorkspaceWithMode("workspace", {
      initialPrompt: "Loading prompt",
      initialIsLoading: true
    });
    expect(loadingHtml).toContain('data-image-workbench-result-loading="true"');
    expect(loadingHtml).toContain("Generating your image...");
    expect(loadingHtml).not.toContain("Generating a new version. Please wait.");

    const successHtml = renderImageWorkspaceWithMode("workspace", {
      initialResult: createGenerationResponse({ prompt: "Real result prompt" })
    });
    expect(successHtml).toContain('data-image-workbench-result-success="true"');
    expect(successHtml).toContain('data-image-workbench-result-image="true"');
    expect(successHtml).toContain('data-image-workbench-task-link="true"');
    expect(successHtml).toContain('data-image-workbench-asset-link="true"');
    expect(successHtml).not.toContain('data-image-workbench-result-entries="true"');
    expect(successHtml).not.toContain('data-image-workbench-result-versions="true"');

    const failedHtml = renderImageWorkspaceWithMode("workspace", {
      initialPrompt: "Failed prompt",
      initialError: "Generation failed safely."
    });
    expect(failedHtml).toContain('data-image-workbench-result-failed="true"');
    expect(failedHtml).toContain("Generation failed safely.");
  });

  it("uses the checking body instead of new-version wording for a first generation", async () => {
    const fetchMock = await mountGenerationPage({
      postHandler: async () =>
        generationJsonResponse(
          { status: "in_progress", taskId: "task-first-generation-checking", retryAfterMs: 2500 },
          202
        ),
      reconcileStatuses: ["running"]
    });

    await clickWorkspaceGenerationButton();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(
      generationHost?.querySelector('[data-image-workbench-result-checking="true"]')
    ).toBeTruthy();
    expect(generationHost?.textContent).not.toContain("Generating a new version. Please wait.");
  });

  it("renders a count-two task as one batch and binds actions to the selected asset", async () => {
    const initialResult = createGenerationResponse(
      { prompt: "A two-image batch", count: 2 },
      {
        taskId: "task-batch-two",
        imageUrls: [
          "https://cdn.example.test/batch-0.png",
          "https://cdn.example.test/batch-1.png"
        ],
        assetMetadata: [0, 1].map((imageOutputIndex) => ({ imageOutputIndex }))
      }
    );
    await mountGenerationPage({ mode: "workspace", initialResult, mobile: true });

    const resultEntries = generationHost?.querySelectorAll<HTMLButtonElement>(
      "[data-image-workbench-result-entry]"
    );
    expect(resultEntries).toHaveLength(2);
    expect(generationHost?.querySelectorAll("[data-image-workbench-version]")).toHaveLength(0);
    expect(generationHost?.querySelector('[data-image-workbench-result-versions="true"]')).toBeNull();
    expect(generationHost?.querySelector("[data-image-workbench-result-entries]" )?.className).toContain(
      "grid"
    );
    expect(generationHost?.querySelector("[data-image-workbench-result-entries] > div")?.className).toContain(
      "overflow-x-auto"
    );
    expect(generationHost?.querySelector("[data-image-workbench-result-entries]")?.className).toContain(
      "min-w-0"
    );

    expect(
      generationHost?.querySelector('[data-image-workbench-result-entry-selected="true"]')
    ).toBe(resultEntries?.[0]);
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image-content]')?.getAttribute("src")
    ).toBe("https://cdn.example.test/batch-0.png");

    await act(async () => {
      resultEntries?.[1]?.click();
      await Promise.resolve();
    });

    expect(
      generationHost?.querySelector('[data-image-workbench-result-entry-selected="true"]')
    ).toBe(resultEntries?.[1]);
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image-content]')?.getAttribute("src")
    ).toBe("https://cdn.example.test/batch-1.png");
    expect(
      generationHost?.querySelector<HTMLAnchorElement>('[data-image-workbench-download="true"]')?.getAttribute("href")
    ).toBe("https://cdn.example.test/batch-1.png");
    expect(
      generationHost?.querySelector<HTMLAnchorElement>('[data-image-workbench-task-link="true"]')?.getAttribute("href")
    ).toBe("/tasks/task-batch-two");
    expect(
      generationHost?.querySelector<HTMLAnchorElement>('[data-image-workbench-asset-link="true"]')?.getAttribute("href")
    ).toBe("/assets/task-batch-two-asset-2");
  });

  it("keeps the selected output when its current version tile is activated", async () => {
    const initialResult = createGenerationResponse(
      { prompt: "Version one", count: 1 },
      { taskId: "task-identity-v1", imageUrl: "https://cdn.example.test/identity-v1.png" }
    );
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "Version two",
      initialResult,
      postHandler: async (_, payload) =>
        generationJsonResponse(
          createGenerationResponse(payload, {
            taskId: "task-identity-v2",
            imageUrls: [
              "https://cdn.example.test/identity-v2-output-1.png",
              "https://cdn.example.test/identity-v2-output-2.png"
            ]
          })
        )
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="2"]'
      )?.click();
      await Promise.resolve();
    });
    await clickWorkspaceGenerationButton();
    await settleGenerationPage();

    const batchEntries = generationHost?.querySelectorAll<HTMLButtonElement>(
      "[data-image-workbench-result-entry]"
    );
    expect(batchEntries).toHaveLength(2);
    await act(async () => {
      batchEntries?.[1]?.click();
      await Promise.resolve();
    });
    const selectedEntryId = generationHost
      ?.querySelector('[data-image-workbench-result-entry-selected="true"]')
      ?.getAttribute("data-image-workbench-result-entry");
    expect(selectedEntryId).toContain("task-identity-v2-asset-2");
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image-content]')?.getAttribute("src")
    ).toBe("https://cdn.example.test/identity-v2-output-2.png");

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-version="2"]'
      )?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector('[data-image-workbench-result-entry-selected="true"]')
        ?.getAttribute("data-image-workbench-result-entry")
    ).toBe(selectedEntryId);
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image-content]')?.getAttribute("src")
    ).toBe("https://cdn.example.test/identity-v2-output-2.png");

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-version="1"]'
      )?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image-content]')?.getAttribute("src")
    ).toBe("https://cdn.example.test/identity-v1.png");
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
  });

  it("shows partial success without converting a non-empty result into failure", async () => {
    const initialResult = createGenerationResponse(
      { prompt: "One of four", count: 4 },
      {
        taskId: "task-partial-four-one",
        imageUrls: ["https://cdn.example.test/partial-one.png"]
      }
    );
    await mountGenerationPage({ mode: "workspace", initialResult, locale: "en-US" });

    expect(generationHost?.querySelector('[data-image-workbench-result-success="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-workbench-partial-success="true"]')?.textContent).toBe(
      "Generated 1 of 4 images. Credits for missing images were refunded automatically."
    );
    expect(generationHost?.querySelector('[data-image-workbench-result-failed="true"]')).toBeNull();
    expect(generationHost?.querySelector('[data-image-workbench-continue-editing="true"]')).toBeNull();

    const zhHtml = renderImageWorkspaceWithMode("workspace", {
      initialResult
    }, "zh-CN");
    expect(zhHtml).toContain("已生成 1 / 4 张，未生成部分的额度已自动退回。");
  });

  it("retains all over-returned assets in one task and shows a non-blocking count diagnostic", async () => {
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      postHandler: async (_, payload) =>
        generationJsonResponse(
          createGenerationResponse(payload, {
            taskId: "task-over-return",
            imageUrls: [
              "https://cdn.example.test/over-1.png",
              "https://cdn.example.test/over-2.png",
              "https://cdn.example.test/over-3.png"
            ]
          })
        )
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="2"]'
      )?.click();
      await Promise.resolve();
    });
    await clickWorkspaceGenerationButton();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(
      JSON.parse(generationRequestBody(generationPostCalls(fetchMock)[0] ?? []))
    ).toMatchObject({ count: 2 });
    expect(
      generationHost?.querySelectorAll('[data-image-workbench-result-entry]')
    ).toHaveLength(3);
    expect(
      generationHost?.querySelectorAll('[data-image-workbench-result-batch]')
    ).toHaveLength(0);
    expect(generationHost?.querySelector('[data-image-workbench-result-entries="true"]')).toBeTruthy();
    expect(
      generationHost?.querySelectorAll('[data-image-workbench-task-link]')
    ).toHaveLength(1);
    expect(
      generationHost?.querySelector('[data-image-workbench-partial-success="true"]')
    ).toBeNull();
    expect(
      generationHost?.querySelector('[data-image-workbench-result-count-violation="true"]')
    ).toBeTruthy();
    expect(generationHost?.textContent).toContain(
      "Unexpected result count: requested 2, received 3."
    );
    expect(generationHost?.textContent).not.toContain("Provider");
  });

  it("shows the equivalent count diagnostic in unified Creator results", () => {
    const html = renderImageWorkspaceWithMode("quick", {
      initialResult: createGenerationResponse(
        { prompt: "Quick over-return", count: 2 },
        {
          taskId: "task-quick-over-return",
          imageUrls: [
            "https://cdn.example.test/quick-over-1.png",
            "https://cdn.example.test/quick-over-2.png",
            "https://cdn.example.test/quick-over-3.png"
          ]
        }
      )
    });

    expect(html.match(/data-image-workbench-result-entry=/g)).toHaveLength(3);
    expect(html).toContain('data-image-workbench-result-count-violation="true"');
    expect(html).toContain("Unexpected result count: requested 2, received 3.");
    expect(html).not.toContain("Generated 2 of 2 images.");
  });

  it.each([
    ["missing", undefined, 3, true],
    ["false", false, 3, true],
    ["true", true, 2, false]
  ] as const)(
    "derives count violation from accepted assets when stored flag is %s",
    (_label, storedViolation, actualCount, expectedViolation) => {
      const requestedCount = 2;
      const response = createGenerationResponse(
        { prompt: "Derived count", count: requestedCount },
        {
          taskId: `task-derived-count-${String(actualCount)}-${String(storedViolation)}`,
          imageUrls: Array.from(
            { length: actualCount },
            (_, index) => `https://cdn.example.test/derived-${index}.png`
          )
        }
      );
      const entry = {
        ...createVersionEntry("succeeded", actualCount + 40),
        requestedCount: requestedCount as 1 | 2 | 4,
        assetCountContractViolation: storedViolation,
        result: response
      };
      const batch = deriveImageResultBatches([entry])[0];

      expect(batch).toBeDefined();
      expect(
        (batch?.acceptedAssetCount ?? 0) > (batch?.requestedCount ?? 0)
      ).toBe(expectedViolation);
      expect(batch?.partialSuccess).toBe(false);
    }
  );

  it("uses accepted real assets for partial success instead of raw asset length", async () => {
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      postHandler: async (_, payload) => {
        const response = createGenerationResponse(payload, {
          taskId: "task-filtered-partial",
          imageUrls: [
            "https://cdn.example.test/filtered-1.png",
            "https://cdn.example.test/filtered-invalid.png"
          ]
        });
        response.assets[1] = {
          ...response.assets[1]!,
          taskId: "another-task"
        };
        return generationJsonResponse(response);
      }
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="2"]'
      )?.click();
      await Promise.resolve();
    });
    await clickWorkspaceGenerationButton();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image-content]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-workbench-partial-success="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-workbench-result-count-violation="true"]')
    ).toBeNull();
    expect(generationHost?.textContent).toContain("Generated 1 of 2 images.");
  });

  it("keeps the single-image result contract without count diagnostics", async () => {
    const initialResult = createGenerationResponse(
      { prompt: "One normal image", count: 1 },
      {
        taskId: "task-single-normal",
        imageUrl: "https://cdn.example.test/single-normal.png"
      }
    );

    await mountGenerationPage({ mode: "workspace", initialResult });

    expect(
      generationHost?.querySelector('[data-image-workbench-result-image-content]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-workbench-partial-success="true"]')
    ).toBeNull();
    expect(
      generationHost?.querySelector('[data-image-workbench-result-count-violation="true"]')
    ).toBeNull();
  });

  it("keeps the old successful batch when a later zero-asset response fails safely", async () => {
    const previousResult = createGenerationResponse(
      { prompt: "Previous success", count: 1 },
      { taskId: "task-previous-success", imageUrl: "https://cdn.example.test/previous.png" }
    );
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialResult: previousResult,
      postHandler: async (_index, payload) =>
        generationJsonResponse(
          createGenerationResponse(payload, {
            taskId: "task-zero-assets",
            imageUrls: []
          })
        )
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-generate="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationHost?.querySelector('[data-image-workbench-result-success="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-workbench-result-latest-failed="true"]')).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image-content]')?.getAttribute("src")
    ).toBe("https://cdn.example.test/previous.png");
    expect(generationHost?.querySelector('[data-image-workbench-partial-success="true"]')).toBeNull();
  });

  it("fails safely when a non-empty response has no accepted task assets", async () => {
    const previousResult = createGenerationResponse(
      { prompt: "Previous accepted result", count: 1 },
      { taskId: "task-accepted-previous", imageUrl: "https://cdn.example.test/accepted-previous.png" }
    );
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialResult: previousResult,
      postHandler: async (_index, payload) => {
        const response = createGenerationResponse(payload, {
          taskId: "task-unmatched-asset",
          imageUrl: "https://cdn.example.test/unmatched.png"
        });
        response.assets[0] = {
          ...response.assets[0]!,
          taskId: "different-task"
        };
        return generationJsonResponse(response);
      }
    });

    await clickWorkspaceGenerationButton();
    await settleGenerationPage();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationHost?.querySelector('[data-image-workbench-result-success="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-workbench-result-latest-failed="true"]')).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image-content]')?.getAttribute("src")
    ).toBe("https://cdn.example.test/accepted-previous.png");
    expect(generationHost?.querySelector('[data-image-workbench-partial-success="true"]')).toBeNull();
    expect(generationHost?.querySelector('[data-image-workbench-result-count-violation="true"]')).toBeNull();
    expect(generationHost?.querySelectorAll('[data-image-workbench-result-batch]')).toHaveLength(0);
    expect(generationHost?.querySelectorAll('[data-image-workbench-result-entry]')).toHaveLength(0);
  });

  it("does not render an empty succeeded result when Quick receives a non-image asset", async () => {
    const fetchMock = await mountGenerationPage({
      mode: "quick",
      postHandler: async (_index, payload) => {
        const response = createGenerationResponse(payload, {
          taskId: "task-non-image-asset",
          imageUrl: "https://cdn.example.test/non-image.png"
        });
        response.assets[0] = {
          ...response.assets[0]!,
          type: "video"
        };
        return generationJsonResponse(response);
      }
    });

    await clickGenerationButton();
    await settleGenerationPage();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationHost?.querySelector('[data-image-ai-status="failed"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-ai-status="succeeded"]')).toBeNull();
    expect(generationHost?.querySelector('[data-image-ai-result="true"]')).toBeNull();
  });

  it("keeps workbench generation parameters structured and exposes the shared quantity contract", async () => {
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "A 16:9 poster, generate 4 images",
      models: [
        imageModel(),
        imageModel({
          id: "model_image_two",
          slug: "image-model-two",
          modelId: "image-model-two",
          name: "Second Image Model",
          displayName: "Second Image Model",
          creditCost: 5,
          sortOrder: 1
        })
      ]
    });

    const quantityOptions = generationHost?.querySelectorAll<HTMLButtonElement>(
      '[data-image-generation-count-option]'
    );
    expect(quantityOptions).toHaveLength(3);
    expect(
      generationHost?.querySelector(
        '[data-image-generation-count-option="1"][data-image-generation-count-selected="true"]'
      )
    ).toBeTruthy();
    expect(generationHost?.textContent).toContain("Count");
    expect(generationHost?.querySelector('[data-image-quick-count-trigger="true"]')).toBeNull();
    expect(
      Array.from(
        generationHost?.querySelectorAll<HTMLButtonElement>(
          '[data-image-generation-count-option]'
        ) ?? []
      ).map((option) => option.getAttribute("data-image-generation-count-option"))
    ).toEqual(["1", "2", "4"]);
    expect(generationHost?.querySelector('[data-image-generation-count-option="3"]')).toBeNull();
    expect(generationHost?.textContent).not.toContain("Auto");
    expect(
      generationHost
        ?.querySelector('[data-image-generation-count-options="true"]')
        ?.getAttribute("role")
    ).toBe("radiogroup");
    expect(
      Array.from(
        generationHost?.querySelectorAll('[data-image-generation-count-option]') ?? []
      ).every((option) => option.getAttribute("role") === "radio" && option.hasAttribute("aria-checked"))
    ).toBe(true);

    const modelSelect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-model="true"]'
    );
    const sizeSelect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-size="true"]'
    );
    expect(modelSelect).toBeTruthy();
    expect(sizeSelect).toBeTruthy();
    const modelControl = generationHost?.querySelector<HTMLElement>(
      '[data-image-parameter-control="model"]'
    );
    const aspectControl = generationHost?.querySelector<HTMLElement>(
      '[data-image-parameter-control="aspect"]'
    );
    expect(modelControl?.className).toContain("rounded-xl");
    expect(aspectControl?.className).toContain("rounded-xl");
    expect(modelControl?.className).toContain("focus-within:ring-2");
    expect(aspectControl?.className).toContain("focus-within:ring-2");
    expect(modelControl?.className).toContain("min-h-11");
    expect(aspectControl?.className).toContain("min-h-11");
    expect(modelControl?.getAttribute("data-image-parameter-focus-surface")).toBe("wrapper");
    expect(aspectControl?.getAttribute("data-image-parameter-focus-surface")).toBe("wrapper");
    expect(modelControl?.parentElement?.className).toContain("self-start");
    expect(aspectControl?.parentElement?.className).toContain("self-start");
    expect(modelControl?.parentElement?.parentElement?.className).toContain(
      "sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
    );
    expect(modelSelect?.className).toContain("appearance-none");
    expect(sizeSelect?.className).toContain("appearance-none");
    expect(modelSelect?.className).not.toContain("focus-visible:ring-2");
    expect(sizeSelect?.className).not.toContain("focus-visible:ring-2");
    expect(modelSelect?.className).not.toContain("max-w");
    expect(modelSelect?.className).not.toContain("truncate");
    expect(modelControl?.querySelector('[data-image-parameter-chevron="true"]')).toBeTruthy();
    expect(aspectControl?.querySelector('[data-image-parameter-chevron="true"]')).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        modelSelect,
        "image-model-two"
      );
      modelSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        sizeSelect,
        "1:1"
      );
      sizeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-generate="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    await settleGenerationPage();

    const postCalls = generationPostCalls(fetchMock);
    expect(postCalls).toHaveLength(1);
    expect(JSON.parse(generationRequestBody(postCalls[0] ?? []))).toMatchObject({
      prompt: "A 16:9 poster, generate 4 images",
      modelId: "image-model-two",
      size: "1024x1024",
      count: 1
    });
    expect(generationHost?.textContent).toContain("Estimated cost: 5");
    expect(generationHost?.querySelector('[data-image-workbench-result-success="true"]')).toBeTruthy();
  });

  it("freezes the selected count for the request and disables workspace choices while running", async () => {
    const deferredResponse = createDeferred<Response>();
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "Freeze the four image request",
      models: [
        imageModel(),
        imageModel({
          id: "model_image_two",
          slug: "image-model-two",
          modelId: "image-model-two",
          displayName: "Second Image Model",
          sortOrder: 1
        })
      ],
      postHandler: async () => deferredResponse.promise
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="4"]'
      )?.click();
      await Promise.resolve();
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-generate="true"]'
      )?.click();
      await Promise.resolve();
    });

    const postCalls = generationPostCalls(fetchMock);
    expect(postCalls).toHaveLength(1);
    expect(
      JSON.parse(generationRequestBody(postCalls[0] ?? []))
    ).toMatchObject({ count: 4 });
    expect(
      Array.from(
        generationHost?.querySelectorAll<HTMLButtonElement>(
          '[data-image-generation-count-option]'
        ) ?? []
      ).every((option) => option.disabled)
    ).toBe(true);
    expect(
      generationHost?.querySelector('[data-image-workbench-result-placeholders="4"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelectorAll('[data-image-workbench-result-placeholder]')
    ).toHaveLength(4);

    const modelSelect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-model="true"]'
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        modelSelect,
        "image-model-two"
      );
      modelSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(JSON.parse(generationRequestBody(postCalls[0] ?? []))).toMatchObject({
      count: 4,
      modelId: "image-model"
    });

    const payload = readGenerationPayload(generationRequestBody(postCalls[0] ?? []));
    await act(async () => {
      deferredResponse.resolve(
        generationJsonResponse(
          createGenerationResponse(payload, {
            taskId: "task-frozen-four",
            imageUrls: Array.from(
              { length: 4 },
              (_, index) => `https://cdn.example.test/frozen-${index}.png`
            )
          })
        )
      );
      await deferredResponse.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(
      Array.from(
        generationHost?.querySelectorAll<HTMLButtonElement>(
          '[data-image-generation-count-option]'
        ) ?? []
      ).every((option) => !option.disabled)
    ).toBe(true);
    expect(
      generationHost?.querySelectorAll('[data-image-workbench-result-entry]')
    ).toHaveLength(4);
  });

  it("uses the result image as the only preview trigger and restores focus", async () => {
    const initialResult = createGenerationResponse({
      prompt: "A real workbench result"
    });
    await mountGenerationPage({ mode: "workspace", initialResult });

    const resultImage = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-workbench-result-image="true"]'
    );
    const taskLink = generationHost?.querySelector<HTMLAnchorElement>(
      '[data-image-workbench-task-link="true"]'
    );
    const assetLink = generationHost?.querySelector<HTMLAnchorElement>(
      '[data-image-workbench-asset-link="true"]'
    );
    expect(resultImage).toBeTruthy();
    expect(taskLink).toBeTruthy();
    expect(assetLink).toBeTruthy();
    expect(generationHost?.textContent).not.toContain("View large");

    await act(async () => {
      resultImage?.focus();
      resultImage?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector('[data-image-preview-dialog="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-preview-zoom-in="true"]'
      )?.getAttribute("aria-label")
    ).toBe("Zoom in");
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-preview-fit="true"]'
      )?.getAttribute("aria-label")
    ).toBe("Fit to window");

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-preview-close="true"]'
      )?.click();
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(resultImage);

    await act(async () => {
      taskLink?.addEventListener("click", (event) => event.preventDefault(), {
        once: true
      });
      assetLink?.addEventListener("click", (event) => event.preventDefault(), {
        once: true
      });
      taskLink?.click();
      assetLink?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector('[data-image-preview-dialog="true"]')
    ).toBeNull();
  });

  it("derives two real versions, switches the selected preview, and binds details to it", async () => {
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Version one prompt",
      postHandler: async (index, payload) =>
        generationJsonResponse(
          createGenerationResponse(payload, {
            taskId: `task-version-${index + 1}`,
            imageUrl: `https://cdn.example.test/version-${index + 1}.png`
          })
        )
    });

    await clickGenerationButton();
    await setGenerationPrompt("Version two prompt");
    await clickGenerationButton();

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-mobile-mode="workbench"]'
      )?.click();
      await Promise.resolve();
    });

    const versions = generationHost?.querySelectorAll<HTMLButtonElement>(
      "[data-image-workbench-version]"
    );
    expect(versions).toHaveLength(2);
    expect(
      generationHost?.querySelector('[data-image-workbench-version="2"][data-image-workbench-version-selected="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-workbench-result-versions="true"] > div')?.className
    ).toContain("overflow-x-auto");
    expect(generationPostCalls(fetchMock)).toHaveLength(2);

    await act(async () => {
      versions?.[0]?.click();
      await Promise.resolve();
    });

    expect(
      generationHost?.querySelector('[data-image-workbench-version="1"][data-image-workbench-version-selected="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image] img')?.getAttribute("src")
    ).toBe("https://cdn.example.test/version-1.png");
    expect(
      generationHost?.querySelector<HTMLAnchorElement>('[data-image-workbench-task-link]')?.getAttribute("href")
    ).toBe("/tasks/task-version-1");
    expect(
      generationHost?.querySelector<HTMLAnchorElement>('[data-image-workbench-asset-link]')?.getAttribute("href")
    ).toBe("/assets/task-version-1-asset");

    await act(async () => {
      versions?.[1]?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector('[data-image-workbench-version="2"][data-image-workbench-version-selected="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image] img')?.getAttribute("src")
    ).toBe("https://cdn.example.test/version-2.png");

    await act(async () => {
      versions?.[0]?.click();
      await Promise.resolve();
    });

    const taskLink = generationHost?.querySelector<HTMLAnchorElement>(
      '[data-image-workbench-task-link]'
    );
    await act(async () => {
      taskLink?.addEventListener("click", (event) => event.preventDefault(), { once: true });
      taskLink?.click();
      await Promise.resolve();
    });
    expect(generationHost?.querySelector('[data-image-preview-dialog]')).toBeNull();

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>('[data-image-workbench-result-image]')?.click();
      await Promise.resolve();
    });
    expect(generationHost?.querySelector('[data-image-preview-dialog]')).toBeTruthy();
  });

  it("reuses the selected submitted prompt without a second POST or aspect normalization", async () => {
    const submittedPrompt = "生成一张 16：9 横版封面";
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: `  ${submittedPrompt}  `
    });
    const promptInput = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-workbench-prompt="true"]'
    );
    const scrollIntoView = vi.fn();
    if (promptInput) {
      Object.defineProperty(promptInput, "scrollIntoView", {
        configurable: true,
        value: scrollIntoView
      });
    }

    await clickWorkspaceGenerationButton();

    expect(promptInput?.value).toBe("");
    expect(
      JSON.parse(generationRequestBody(generationPostCalls(fetchMock)[0] ?? []))
    ).toMatchObject({ prompt: submittedPrompt });
    expect(reusePromptButton()?.textContent).toContain("Reuse prompt");
    expect(generationPostCalls(fetchMock)).toHaveLength(1);

    await clickReusePromptButton();

    expect(promptInput?.value).toBe(submittedPrompt);
    expect(document.activeElement).toBe(promptInput);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center"
    });
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(promptInput?.value).not.toContain("16:9");
  });

  it.each([
    [
      "en-US",
      "Reuse prompt",
      "Replace current prompt?",
      "The prompt composer already has content. Replace it with the prompt used to generate this image?",
      "Confirm replacement"
    ],
    [
      "zh-CN",
      "复用提示词",
      "替换当前提示词？",
      "当前输入框已有内容。是否用这张图片生成时的提示词替换当前内容？",
      "确认替换"
    ]
  ] as const)(
    "localizes Reuse prompt and its overwrite confirmation in %s",
    async (locale, actionLabel, title, message, confirmLabel) => {
      const fetchMock = await mountGenerationPage({
        locale,
        mode: "workspace",
        initialPrompt: "Current draft",
        initialResult: createGenerationResponse({ prompt: "Source prompt" })
      });

      expect(reusePromptButton()?.textContent).toContain(actionLabel);
      await clickReusePromptButton();
      expect(generationHost?.textContent).toContain(title);
      expect(generationHost?.textContent).toContain(message);
      expect(generationHost?.textContent).toContain(confirmLabel);
      expect(generationPostCalls(fetchMock)).toHaveLength(0);
    }
  );

  it("focuses without opening confirmation when the composer already equals the source", async () => {
    const sourcePrompt = "Keep this exact prompt";
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: sourcePrompt,
      initialResult: createGenerationResponse({ prompt: sourcePrompt })
    });
    const promptInput = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-workbench-prompt="true"]'
    );

    await clickReusePromptButton();

    expect(promptInput?.value).toBe(sourcePrompt);
    expect(document.activeElement).toBe(promptInput);
    expect(generationHost?.querySelector('[role="dialog"]')).toBeNull();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("confirms before replacing a different composer prompt and keeps cancel non-destructive", async () => {
    const sourcePrompt = "Prompt used for the selected image";
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "Current composer draft",
      initialResult: createGenerationResponse({
        prompt: sourcePrompt
      })
    });
    const promptInput = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-workbench-prompt="true"]'
    );
    const sourceImage = generationHost?.querySelector<HTMLImageElement>(
      '[data-image-workbench-result-image] img'
    )?.getAttribute("src");

    await clickReusePromptButton();

    expect(generationHost?.querySelector('[role="dialog"]')).toBeTruthy();
    expect(generationHost?.textContent).toContain("Replace current prompt?");
    expect(generationHost?.textContent).toContain(
      "The prompt composer already has content. Replace it with the prompt used to generate this image?"
    );
    expect(promptInput?.value).toBe("Current composer draft");
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
    expect(
      generationHost?.querySelector<HTMLImageElement>(
        '[data-image-workbench-result-image] img'
      )?.getAttribute("src")
    ).toBe(sourceImage);

    const cancelButton = Array.from(
      generationHost?.querySelectorAll<HTMLButtonElement>('[role="dialog"] button') ?? []
    ).find((button) => button.textContent === "Cancel");
    expect(cancelButton).toBeTruthy();
    await act(async () => {
      cancelButton?.click();
      await Promise.resolve();
    });

    expect(generationHost?.querySelector('[role="dialog"]')).toBeNull();
    expect(promptInput?.value).toBe("Current composer draft");
    expect(generationPostCalls(fetchMock)).toHaveLength(0);

    await clickReusePromptButton();
    const confirmButton = Array.from(
      generationHost?.querySelectorAll<HTMLButtonElement>('[role="dialog"] button') ?? []
    ).find((button) => button.textContent === "Confirm replacement");
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(promptInput?.value).toBe(sourcePrompt);
    expect(document.activeElement).toBe(promptInput);
    expect(generationHost?.querySelector('[role="dialog"]')).toBeNull();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("changes only the prompt while preserving model, explicit aspect, count, and reference", async () => {
    const referenceImage = {
      dataUrl: "data:image/jpeg;base64,existing-reference",
      mimeType: "image/jpeg",
      name: "existing-reference.jpg",
      originalBytes: 120,
      compressedBytes: 90
    };
    const secondModel = imageModel({
      id: "model_image_two",
      slug: "image-model-two",
      modelId: "image-model-two",
      displayName: "Second Image Model",
      sortOrder: 1
    });
    const sourcePrompt = "Prompt with settings that must remain unchanged";
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "",
      initialResult: createGenerationResponse({ prompt: sourcePrompt }),
      initialReferenceImage: referenceImage,
      models: [imageModel(), secondModel]
    });
    const modelSelect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-model="true"]'
    );
    const aspectSelect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-size="true"]'
    );
    const referenceSrc = generationHost?.querySelector<HTMLImageElement>(
      '[data-reference-image-preview="true"] img'
    )?.getAttribute("src");

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        modelSelect,
        "image-model-two"
      );
      modelSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        aspectSelect,
        "16:9"
      );
      aspectSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="4"]'
      )?.click();
      await Promise.resolve();
    });

    await clickReusePromptButton();

    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-workbench-prompt="true"]'
      )?.value
    ).toBe(sourcePrompt);
    expect(modelSelect?.value).toBe("image-model-two");
    expect(aspectSelect?.value).toBe("16:9");
    expect(
      generationHost?.querySelector(
        '[data-image-generation-count-option="4"][data-image-generation-count-selected="true"]'
      )
    ).toBeTruthy();
    expect(
      generationHost?.querySelector<HTMLImageElement>(
        '[data-reference-image-preview="true"] img'
      )?.getAttribute("src")
    ).toBe(referenceSrc);
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("keeps the originating prompt when switching assets inside a four-image batch", async () => {
    const sourcePrompt = "One prompt for four generated assets";
    const initialResult = createGenerationResponse(
      { prompt: sourcePrompt, count: 4 },
      {
        taskId: "task-four-reuse",
        imageUrls: [
          "https://cdn.example.test/four-reuse-1.png",
          "https://cdn.example.test/four-reuse-2.png",
          "https://cdn.example.test/four-reuse-3.png",
          "https://cdn.example.test/four-reuse-4.png"
        ],
        assetIds: [
          "four-reuse-1",
          "four-reuse-2",
          "four-reuse-3",
          "four-reuse-4"
        ]
      }
    );
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "",
      initialResult
    });
    const resultEntries = generationHost?.querySelectorAll<HTMLButtonElement>(
      "[data-image-workbench-result-entry]"
    );

    expect(resultEntries).toHaveLength(4);
    await act(async () => {
      resultEntries?.[3]?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector(
        '[data-image-workbench-result-entry="task-four-reuse:four-reuse-4"][data-image-workbench-result-entry-selected="true"]'
      )
    ).toBeTruthy();

    await clickReusePromptButton();

    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-workbench-prompt="true"]'
      )?.value
    ).toBe(sourcePrompt);
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("uses the prompt belonging to the selected historical version", async () => {
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "版本 B",
      initialResult: createGenerationResponse(
        { prompt: "版本 A" },
        { taskId: "task-version-a", imageUrl: "https://cdn.example.test/version-a.png" }
      ),
      postHandler: async (_index, payload) =>
        generationJsonResponse(
          createGenerationResponse(payload, {
            taskId: "task-version-b",
            imageUrl: "https://cdn.example.test/version-b.png"
          })
        )
    });

    await clickWorkspaceGenerationButton();
    const versions = generationHost?.querySelectorAll<HTMLButtonElement>(
      "[data-image-workbench-version]"
    );
    expect(versions).toHaveLength(2);

    await act(async () => {
      versions?.[0]?.click();
      await Promise.resolve();
    });
    await clickReusePromptButton();
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("版本 A");

    await setGenerationPrompt("");
    await act(async () => {
      versions?.[1]?.click();
      await Promise.resolve();
    });
    await clickReusePromptButton();

    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("版本 B");
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
  });

  it("does not show Reuse prompt when the selected result has no reliable provenance", async () => {
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "",
      initialResult: createGenerationResponse(
        { prompt: "" },
        { taskId: "task-no-prompt", imageUrl: "https://cdn.example.test/no-prompt.png" }
      )
    });

    expect(reusePromptButton()).toBeFalsy();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("continues editing from the selected complete asset without automatic POST", async () => {
    const privateUrl = "/assets/continue-source/content";
    const initialResult = createGenerationResponse(
      { prompt: "Restore the selected source prompt" },
      { taskId: "task-continue-source", imageUrl: privateUrl }
    );
    initialResult.assets[0]!.thumbnailUrl = "/generated-assets/continue-thumb.png";
    mockObjectUrlMethods(["blob:continue-preview"]);
    mockReferenceCompressionBrowser();
    await expect(
      compressReferenceImage(new Blob(["continuation"], { type: "image/png" }))
    ).resolves.toMatchObject({
      dataUrl: referenceCompressionDataUrl,
      sourceWidth: 800,
      sourceHeight: 600
    });
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "",
      initialResult,
      assetContentHandler: async () => privateImageResponse()
    });

    const beforeContentReads = generationAssetContentCalls(fetchMock).length;
    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-continue-editing="true"]'
      )?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    });
    await settleGenerationPage();

    expect(generationAssetContentCalls(fetchMock)).toHaveLength(beforeContentReads + 1);
    expect(
      generationHost?.querySelector('[data-image-workbench-continuation-source="true"]')
    ).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-workbench-generation-mode="image-to-image"]')).toBeTruthy();
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>('[data-image-workbench-prompt="true"]')?.value
    ).toBe("Restore the selected source prompt");
    expect(generationPostCalls(fetchMock)).toHaveLength(0);

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>('[data-image-workbench-generate="true"]')?.click();
      await Promise.resolve();
    });
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(
      JSON.parse(generationRequestBody(generationPostCalls(fetchMock)[0] ?? []))
    ).toMatchObject({
      mode: "image-to-image",
      count: 1,
      referenceImages: [{
        dataUrl: referenceCompressionDataUrl,
        mimeType: "image/jpeg"
      }]
    });
  });

  it("continues editing from the selected batch asset with one reference and resets continuation settings", async () => {
    const initialResult = createGenerationResponse(
      { prompt: "Use the second generated image", count: 2 },
      {
        taskId: "task-continue-batch",
        imageUrls: [
          "/assets/asset-one/content",
          "/assets/asset-two/content"
        ],
        assetIds: ["asset-one", "asset-two"]
      }
    );
    mockReferenceCompressionBrowser();
    await expect(
      compressReferenceImage(new Blob(["continuation"], { type: "image/png" }))
    ).resolves.toMatchObject({
      dataUrl: referenceCompressionDataUrl,
      sourceWidth: 800,
      sourceHeight: 600
    });
    mockObjectUrlMethods(Array.from({ length: 8 }, (_, index) => `blob:batch-${index}`));
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "",
      initialResult,
      assetContentHandler: async () => privateImageResponse(),
      postHandler: async (_index, payload) =>
        generationJsonResponse(createGenerationResponse(payload, { taskId: "task-continued" }))
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="2"]'
      )?.click();
      await Promise.resolve();
    });
    const resultEntries = generationHost?.querySelectorAll<HTMLButtonElement>(
      "[data-image-workbench-result-entry]"
    );
    expect(resultEntries).toHaveLength(2);
    await act(async () => {
      resultEntries?.[1]?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    const contentReadsBeforeContinuation = generationAssetContentCalls(fetchMock).length;
    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-continue-editing="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();

    const continuationReads = generationAssetContentCalls(fetchMock).slice(
      contentReadsBeforeContinuation
    );
    expect(continuationReads.length).toBeGreaterThan(0);
    expect(
      continuationReads.every(([input]) => generationUrl(input).pathname.includes("asset-two"))
    ).toBe(true);
    expect(imagePageSource).toContain("const compressed = await compressReferenceImage(blob);");
    expect(
      generationHost?.querySelector(
        '[data-image-generation-count-option="1"][data-image-generation-count-selected="true"]'
      )
    ).toBeTruthy();
    expect(
      generationHost?.querySelector<HTMLSelectElement>('[data-image-workbench-size="true"]')?.value
    ).toBe("auto");

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-generate="true"]'
      )?.click();
      await Promise.resolve();
    });
    const payload = JSON.parse(
      generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({ count: 1, size: "1024x768" });
    expect(payload.referenceImages).toMatchObject([{
      dataUrl: referenceCompressionDataUrl,
      mimeType: "image/jpeg"
    }]);
    expect("referenceImage" in payload).toBe(false);
  });

  it("hydrates a valid handoff through the owner API, locks preparation controls, and waits for Generate", async () => {
    const handoffAsset: AiAssetSummary = {
      id: "handoff-asset",
      userId: "user-1",
      taskId: "handoff-task",
      type: "image",
      url: "/assets/handoff-asset/content",
      thumbnailUrl: null,
      title: "Handoff source",
      metadata: { modelId: "source-model" },
      createdAt: "2026-07-15T00:00:00.000Z",
      taskPrompt: "Use the source metadata only when the destination prompt is empty"
    };
    const handoffTask = createGenerationResponse(
      { prompt: handoffAsset.taskPrompt ?? "Source prompt", modelId: "source-model" },
      { taskId: "handoff-task", imageUrl: handoffAsset.url }
    ).task;
    const contentRead = createDeferred<Response>();
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "",
      models: [imageModel({ slug: "destination-model", modelId: "destination-model" })],
      handoffAsset,
      handoffTask,
      assetContentHandler: async () => contentRead.promise
    });

    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-reference-preparation="PREPARING_REFERENCE"]')).toBeTruthy();
    expect(
      generationHost?.querySelector<HTMLButtonElement>('[data-image-generation-count-option="2"]')?.disabled
    ).toBe(true);
    expect(generationHost?.querySelector<HTMLSelectElement>('[data-image-workbench-size="true"]')?.disabled).toBe(true);
    expect(generationHost?.querySelector<HTMLButtonElement>('[data-image-workbench-generate="true"]')?.disabled).toBe(true);
    expect(generationPostCalls(fetchMock)).toHaveLength(0);

    const ownerCall = fetchMock.mock.calls.find(([input]) => {
      const url = generationUrl(input);
      return url.pathname === "/api/assets/handoff-asset";
    });
    expect(ownerCall).toBeTruthy();
    expect(generationRequestHeaders(ownerCall ?? []).get("Authorization")).toBe("Bearer token");

    await setGenerationPrompt("User edited during preparation");
    await act(async () => {
      contentRead.resolve(privateImageResponse());
      await Promise.resolve();
    });
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();

    expect(generationHost?.querySelector('[data-image-reference-preparation="PREPARING_REFERENCE"]')).toBeNull();
    expect(generationHost?.querySelector('[data-image-workbench-reference]')).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-generation-count-option="1"][data-image-generation-count-selected="true"]')
    ).toBeTruthy();
    expect(generationHost?.querySelector<HTMLSelectElement>('[data-image-workbench-size="true"]')?.value).toBe("auto");
    expect(generationHost?.querySelector<HTMLSelectElement>('[data-image-workbench-model="true"]')?.value).toBe("destination-model");
    expect(generationHost?.querySelector<HTMLTextAreaElement>('[data-image-workbench-prompt="true"]')?.value).toBe(
      "User edited during preparation"
    );
    expect(generationHost?.textContent).toContain("Estimated cost: 2");
    expect(generationHost?.querySelector<HTMLButtonElement>('[data-image-workbench-generate="true"]')?.disabled).toBe(false);
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
    expect(readImageCreationHandoff()).toMatchObject({ assetId: "handoff-asset" });
    expect(
      fetchMock.mock.calls
        .filter(([input]) => generationUrl(input).pathname.endsWith("/content"))
        .every(([, init]) => generationRequestHeaders([null, init]).get("Authorization") === "Bearer token")
    ).toBe(true);
  });

  it("keeps mobile reference preparation actionable with the existing discard handler", async () => {
    const handoffAsset: AiAssetSummary = {
      id: "mobile-preparing-handoff-asset",
      userId: "user-1",
      taskId: null,
      type: "image",
      url: "/assets/mobile-preparing-handoff-asset/content",
      thumbnailUrl: null,
      title: "Mobile preparation source",
      metadata: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      taskPrompt: null
    };
    const contentRead = createDeferred<Response>();
    mockReferenceCompressionBrowser();
    await mountGenerationPage({
      mobile: true,
      handoffAsset,
      assetContentHandler: async () => contentRead.promise
    });
    await settleGenerationPage();

    const feedback = generationHost?.querySelector<HTMLElement>(
      '[data-image-mobile-reference-preparation="PREPARING_REFERENCE"]'
    );
    const discard = feedback?.querySelector<HTMLButtonElement>(
      '[data-image-mobile-reference-discard="true"]'
    );
    expect(feedback?.getAttribute("role")).toBe("status");
    expect(feedback?.getAttribute("aria-live")).toBe("polite");
    expect(discard?.textContent).toContain("Discard");

    await act(async () => {
      discard?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(
      generationHost?.querySelector('[data-image-mobile-reference-preparation="PREPARING_REFERENCE"]')
    ).toBeNull();
    expect(readImageCreationHandoff()).toBeNull();
  });

  it("keeps mobile transient reference preparation retryable instead of leaving only Generate disabled", async () => {
    const handoffAsset: AiAssetSummary = {
      id: "mobile-transient-handoff-asset",
      userId: "user-1",
      taskId: null,
      type: "image",
      url: "/assets/mobile-transient-handoff-asset/content",
      thumbnailUrl: null,
      title: "Mobile transient source",
      metadata: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      taskPrompt: null
    };
    let ownerAttempts = 0;
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      mobile: true,
      handoffAsset,
      handoffOwnerHandler: async () => {
        ownerAttempts += 1;
        if (ownerAttempts === 1) {
          throw new Error("temporary network failure");
        }
        return generationJsonResponse({ asset: handoffAsset, task: null });
      },
      assetContentHandler: async () => privateImageResponse()
    });
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    });
    await settleGenerationPage();

    const feedback = generationHost?.querySelector<HTMLElement>(
      '[data-image-mobile-reference-preparation="TRANSIENT_FAILURE"]'
    );
    const retry = feedback?.querySelector<HTMLButtonElement>(
      '[data-image-mobile-reference-retry="true"]'
    );
    const discard = feedback?.querySelector<HTMLButtonElement>(
      '[data-image-mobile-reference-discard="true"]'
    );
    expect(feedback?.getAttribute("role")).toBe("alert");
    expect(retry?.textContent).toContain("Retry");
    expect(discard?.textContent).toContain("Discard");
    expect(
      generationHost?.querySelector<HTMLButtonElement>('[data-image-mobile-generate-button="true"]')
        ?.disabled
    ).toBe(true);

    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();

    expect(ownerAttempts).toBe(2);
    expect(
      generationHost?.querySelector('[data-image-mobile-reference-preparation="TRANSIENT_FAILURE"]')
    ).toBeNull();
    expect(generationHost?.querySelector('[data-image-workbench-reference="true"]')).toBeTruthy();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("processes a new Asset handoff after leaving and returning to /image", async () => {
    const firstAsset: AiAssetSummary = {
      id: "repeat-handoff-asset-a",
      userId: "user-1",
      taskId: null,
      type: "image",
      url: "/assets/repeat-handoff-asset-a/content",
      thumbnailUrl: null,
      title: "First continuation",
      metadata: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      taskPrompt: null
    };
    const secondAsset = {
      ...firstAsset,
      id: "repeat-handoff-asset-b",
      url: "/assets/repeat-handoff-asset-b/content",
      title: "Second continuation"
    };
    mockReferenceCompressionBrowser();
    const firstFetch = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "",
      handoffAsset: firstAsset,
      assetContentHandler: async () => privateImageResponse()
    });
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();
    expect(
      generationHost?.querySelector('[data-image-reference-preparation-state="READY"]')
    ).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-workbench-reference]')).toBeTruthy();
    expect(generationPostCalls(firstFetch)).toHaveLength(0);

    await act(async () => generationRoot?.unmount());
    generationHost?.remove();
    generationRoot = null;
    generationHost = null;

    const secondFetch = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "",
      handoffAsset: secondAsset,
      assetContentHandler: async () => privateImageResponse(),
      preserveStorage: true
    });
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    });
    await settleGenerationPage();

    const secondHost = generationHost as HTMLDivElement | null;
    expect(
      secondHost?.querySelector('[data-image-reference-preparation-state="READY"]')
    ).toBeTruthy();
    expect(secondHost?.querySelector('[data-image-workbench-reference]')).toBeTruthy();
    expect(secondHost?.querySelector('[data-image-reference-preparation="PREPARING_REFERENCE"]')).toBeNull();
    expect(generationPostCalls(secondFetch)).toHaveLength(0);
  });

  it("leaves PREPARING_REFERENCE through a bounded transient failure when preparation never settles", async () => {
    const handoffAsset: AiAssetSummary = {
      id: "timeout-handoff-asset",
      userId: "user-1",
      taskId: null,
      type: "image",
      url: "/assets/timeout-handoff-asset/content",
      thumbnailUrl: null,
      title: "Timeout source",
      metadata: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      taskPrompt: null
    };
    let underlyingAbortError: unknown = null;
    mockReferenceCompressionBrowser();
    vi.useFakeTimers();
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "Keep this prompt",
      handoffAsset,
      handoffOwnerHandler: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const rejectWithAbortError = () => {
            underlyingAbortError = new DOMException("The operation was aborted", "AbortError");
            reject(underlyingAbortError);
          };

          if (signal?.aborted) {
            rejectWithAbortError();
            return;
          }

          signal?.addEventListener("abort", rejectWithAbortError, { once: true });
        })
    });

    await settleGenerationPage();
    expect(
      generationHost?.querySelector('[data-image-reference-preparation="PREPARING_REFERENCE"]')
    ).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(imageReferencePreparationTimeoutMs);
    });
    await settleGenerationPage();

    expect(underlyingAbortError).toMatchObject({ name: "AbortError" });
    expect(
      generationHost?.querySelector('[data-image-reference-preparation="PREPARING_REFERENCE"]')
    ).toBeNull();
    expect(
      generationHost?.querySelector('[data-image-reference-preparation="TRANSIENT_FAILURE"]')
    ).toBeTruthy();
    expect(
      Array.from(generationHost?.querySelectorAll("button") ?? []).some((button) =>
        button.textContent?.includes("Retry")
      )
    ).toBe(true);
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("keeps a transient handoff failure retryable and discards it without changing the draft", async () => {
    const handoffAsset: AiAssetSummary = {
      id: "retry-handoff-asset",
      userId: "user-1",
      taskId: null,
      type: "image",
      url: "/assets/retry-handoff-asset/content",
      thumbnailUrl: null,
      title: "Retry source",
      metadata: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      taskPrompt: null
    };
    let ownerAttempts = 0;
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "Keep this draft",
      handoffAsset,
      handoffOwnerHandler: async () => {
        ownerAttempts += 1;
        if (ownerAttempts === 1) {
          throw new Error("temporary network failure");
        }
        return generationJsonResponse({ asset: handoffAsset, task: null });
      },
      assetContentHandler: async () => privateImageResponse()
    });

    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    });
    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-reference-preparation="TRANSIENT_FAILURE"]')).toBeTruthy();
    expect(readImageCreationHandoff()).toMatchObject({ assetId: "retry-handoff-asset" });
    expect(generationHost?.querySelector<HTMLTextAreaElement>('[data-image-workbench-prompt="true"]')?.value).toBe(
      "Keep this draft"
    );

    const retryButton = Array.from(
      generationHost?.querySelectorAll<HTMLButtonElement>("button") ?? []
    ).find((button) => button.textContent?.includes("Retry"));
    await act(async () => {
      retryButton?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();

    expect(ownerAttempts).toBe(2);
    expect(generationHost?.querySelector('[data-image-workbench-reference]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-reference-preparation="TRANSIENT_FAILURE"]')).toBeNull();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);

    const discardButton = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-workbench-reference-remove="true"]'
    );
    await act(async () => {
      discardButton?.click();
      await Promise.resolve();
    });
    expect(readImageCreationHandoff()).toBeNull();
  });

  it("classifies a real owner 503 as transient and retries the owner lookup", async () => {
    const handoffAsset: AiAssetSummary = {
      id: "owner-503-handoff-asset",
      userId: "user-1",
      taskId: null,
      type: "image",
      url: "/assets/owner-503-handoff-asset/content",
      thumbnailUrl: null,
      title: "Owner 503 source",
      metadata: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      taskPrompt: "Must not cross the handoff boundary"
    };
    let ownerAttempts = 0;
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "Keep destination prompt",
      handoffAsset,
      handoffOwnerHandler: async () => {
        ownerAttempts += 1;
        return ownerAttempts === 1
          ? generationJsonResponse({ message: "upstream unavailable" }, 503)
          : generationJsonResponse({ asset: handoffAsset, task: null });
      },
      assetContentHandler: async () => privateImageResponse()
    });

    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-reference-preparation="TRANSIENT_FAILURE"]')).toBeTruthy();
    expect(readImageCreationHandoff()).toMatchObject({ assetId: handoffAsset.id });
    expect(generationPostCalls(fetchMock)).toHaveLength(0);

    const retryButton = Array.from(
      generationHost?.querySelectorAll<HTMLButtonElement>("button") ?? []
    ).find((button) => button.textContent?.includes("Retry"));
    await act(async () => {
      retryButton?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();

    expect(ownerAttempts).toBe(2);
    expect(generationHost?.querySelector('[data-image-workbench-reference]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-reference-preparation="TRANSIENT_FAILURE"]')).toBeNull();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>('[data-image-workbench-prompt="true"]')?.value
    ).toBe("Keep destination prompt");
  });

  it("classifies a real private content 503 as transient and retries content", async () => {
    const handoffAsset: AiAssetSummary = {
      id: "content-503-handoff-asset",
      userId: "user-1",
      taskId: null,
      type: "image",
      url: "/assets/content-503-handoff-asset/content",
      thumbnailUrl: null,
      title: "Content 503 source",
      metadata: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      taskPrompt: null
    };
    let contentAttempts = 0;
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      handoffAsset,
      assetContentHandler: async () => {
        contentAttempts += 1;
        return contentAttempts === 1
          ? generationJsonResponse({ message: "content unavailable" }, 503)
          : privateImageResponse();
      }
    });

    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-reference-preparation="TRANSIENT_FAILURE"]')).toBeTruthy();
    expect(readImageCreationHandoff()).toMatchObject({ assetId: handoffAsset.id });
    expect(generationPostCalls(fetchMock)).toHaveLength(0);

    const retryButton = Array.from(
      generationHost?.querySelectorAll<HTMLButtonElement>("button") ?? []
    ).find((button) => button.textContent?.includes("Retry"));
    await act(async () => {
      retryButton?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();

    expect(contentAttempts).toBe(2);
    expect(generationHost?.querySelector('[data-image-workbench-reference]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-reference-preparation="TRANSIENT_FAILURE"]')).toBeNull();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("classifies a real owner 404 as terminal and clears the handoff", async () => {
    const handoffAsset: AiAssetSummary = {
      id: "owner-404-handoff-asset",
      userId: "user-1",
      taskId: null,
      type: "image",
      url: "/assets/owner-404-handoff-asset/content",
      thumbnailUrl: null,
      title: "Deleted source",
      metadata: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      taskPrompt: null
    };
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      handoffAsset,
      handoffOwnerHandler: async () =>
        generationJsonResponse({ message: "not found" }, 404),
      assetContentHandler: async () => privateImageResponse()
    });

    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-reference-preparation="TERMINAL_FAILURE"]')).toBeNull();
    expect(generationHost?.querySelector('[data-image-reference-preparation="TRANSIENT_FAILURE"]')).toBeNull();
    expect(readImageCreationHandoff()).toBeNull();
    expect(
      Array.from(generationHost?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .some((button) => button.textContent?.includes("Retry"))
    ).toBe(false);
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generate-button="true"], [data-image-workbench-generate="true"]'
      )?.disabled
    ).toBe(false);
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("does not retry an expired handoff after a transient failure", async () => {
    const handoffAsset: AiAssetSummary = {
      id: "expired-retry-handoff-asset",
      userId: "user-1",
      taskId: null,
      type: "image",
      url: "/assets/expired-retry-handoff-asset/content",
      thumbnailUrl: null,
      title: "Expired retry source",
      metadata: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      taskPrompt: null
    };
    let ownerAttempts = 0;
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      handoffAsset,
      handoffOwnerHandler: async () => {
        ownerAttempts += 1;
        return generationJsonResponse({ message: "temporary owner failure" }, 503);
      },
      assetContentHandler: async () => privateImageResponse()
    });

    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-reference-preparation="TRANSIENT_FAILURE"]')).toBeTruthy();
    expect(readImageCreationHandoff()).toMatchObject({ assetId: handoffAsset.id });
    const expiredNow = Date.now() + imageCreationHandoffTtlMs + 1;
    vi.spyOn(Date, "now").mockReturnValue(expiredNow);

    const callsBeforeRetry = fetchMock.mock.calls.length;
    const retryButton = Array.from(
      generationHost?.querySelectorAll<HTMLButtonElement>("button") ?? []
    ).find((button) => button.textContent?.includes("Retry"));
    await act(async () => {
      retryButton?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(ownerAttempts).toBe(1);
    expect(fetchMock.mock.calls.length).toBe(callsBeforeRetry);
    expect(readImageCreationHandoff()).toBeNull();
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generate-button="true"], [data-image-workbench-generate="true"]'
      )?.disabled
    ).toBe(false);
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("aborts pending handoff work on an actual WorkspaceShell account switch", async () => {
    const handoffAsset: AiAssetSummary = {
      id: "auth-switch-pending-asset",
      userId: "workspace-user-a",
      taskId: "auth-switch-task",
      type: "image",
      url: "/assets/auth-switch-pending-asset/content",
      thumbnailUrl: null,
      title: "Account A source",
      metadata: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      taskPrompt: "Must never cross the account boundary"
    };
    const contentRead = createDeferred<Response>();
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      workspaceAuth: true,
      mode: "workspace",
      initialToken: "stale-server-token",
      initialPrompt: "",
      handoffAsset,
      assetContentHandler: async () => contentRead.promise
    });

    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-reference-preparation="PREPARING_REFERENCE"]')).toBeTruthy();
    const ownerCall = fetchMock.mock.calls.find(([input]) => {
      const url = generationUrl(input);
      return url.pathname === "/api/assets/auth-switch-pending-asset";
    });
    expect(ownerCall).toBeTruthy();
    expect(generationRequestHeaders(ownerCall ?? []).get("Authorization")).toBe("Bearer token-a");

    const callsBeforeSwitch = fetchMock.mock.calls.length;
    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-workspace-auth-logout="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-workspace-auth-switch="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(readImageCreationHandoff()).toBeNull();
    expect(generationHost?.querySelector('[data-image-workbench-reference-remove="true"]')).toBeNull();
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-composer-prompt="true"], [data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("");
    expect(
      fetchMock.mock.calls.slice(callsBeforeSwitch).some(([input]) => {
        const url = generationUrl(input);
        return url.pathname === "/api/assets/auth-switch-pending-asset" ||
          url.pathname.endsWith("/content");
      })
    ).toBe(false);

    await act(async () => {
      contentRead.resolve(privateImageResponse());
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-workbench-reference-remove="true"]')).toBeNull();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
    expect(
      generationHost?.querySelector(
        '[data-image-generate-button="true"], [data-image-workbench-generate="true"]'
      )
    ).toBeTruthy();
  });

  it("clears a READY handoff reference on actual WorkspaceShell logout", async () => {
    const handoffAsset: AiAssetSummary = {
      id: "auth-logout-ready-asset",
      userId: "workspace-user-a",
      taskId: null,
      type: "image",
      url: "/assets/auth-logout-ready-asset/content",
      thumbnailUrl: null,
      title: "Account A ready source",
      metadata: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      taskPrompt: "Never inherited"
    };
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      workspaceAuth: true,
      mode: "workspace",
      initialToken: "stale-server-token",
      initialPrompt: "",
      handoffAsset,
      assetContentHandler: async () => privateImageResponse()
    });

    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-workbench-reference-remove="true"]')).toBeTruthy();
    expect(readImageCreationHandoff()).toMatchObject({ assetId: handoffAsset.id });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-workspace-auth-logout="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(readImageCreationHandoff()).toBeNull();
    expect(generationHost?.querySelector('[data-image-workbench-reference-remove="true"]')).toBeNull();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
    expect(
      generationHost?.querySelector(
        '[data-image-generate-button="true"], [data-image-workbench-generate="true"]'
      )
    ).toBeTruthy();
  });

  it("clears the full local image draft across a real WorkspaceShell logout and B login", async () => {
    const handoffAsset: AiAssetSummary = {
      id: "auth-switch-manual-reference-asset",
      userId: "workspace-user-a",
      taskId: null,
      type: "image",
      url: "/assets/auth-switch-manual-reference-asset/content",
      thumbnailUrl: null,
      title: "Incoming source",
      metadata: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      taskPrompt: null
    };
    const manualReference = {
      dataUrl: "data:image/jpeg;base64,bWFudWFs",
      mimeType: "image/jpeg",
      name: "manual.jpg",
      originalBytes: 1024,
      compressedBytes: 512
    } as const;
    const fetchMock = await mountGenerationPage({
      workspaceAuth: true,
      mode: "workspace",
      initialToken: "stale-server-token",
      initialPrompt: "Account A private prompt",
      initialReferenceImage: manualReference,
      handoffAsset,
      assetContentHandler: async () => privateImageResponse()
    });

    await settleGenerationPage();
    expect(generationHost?.querySelector('[data-image-workbench-reference]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-reference-preparation="PREPARING_REFERENCE"]')).toBeNull();
    const accountAHandoffKey = getImageCreationHandoffStorageKey("workspace-user-a");
    expect(window.sessionStorage.getItem(accountAHandoffKey)).toBeTruthy();

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-workspace-auth-logout="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(window.sessionStorage.getItem(accountAHandoffKey)).toBeNull();

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-workspace-auth-switch="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-composer-prompt="true"], [data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("");

    expect(readImageCreationHandoff()).toBeNull();
    expect(window.sessionStorage.getItem(accountAHandoffKey)).toBeNull();
    expect(generationHost?.querySelector('[data-image-workbench-reference-remove="true"]')).toBeNull();
    const storedBSession = parseStoredImageSessions(
      window.sessionStorage.getItem(getImageSessionsStorageKey("user:workspace-user-b"))
    );
    expect(JSON.stringify(storedBSession ?? "")).not.toContain("Account A private prompt");
    expect(JSON.stringify(storedBSession ?? "")).not.toContain("manual.jpg");

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-workspace-auth-login-a="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(readImageCreationHandoff()).toBeNull();
    expect(window.sessionStorage.getItem(accountAHandoffKey)).toBeNull();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("clears malformed handoffs and leaves normal image generation available", async () => {
    const fetchMock = await mountGenerationPage({ rawHandoff: "{" });

    expect(readImageCreationHandoff()).toBeNull();
    expect(generationHost?.querySelector('[data-image-reference-preparation]')).toBeNull();
    expect(generationButton()?.disabled).toBe(false);
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("does not apply A history or quota after logout and B login", async () => {
    const pendingAHistory = createDeferred<Response>();
    const pendingAQuota = createDeferred<Response>();
    const aHistoryTask = createGenerationResponse(
      { prompt: "Account A private task", imageSessionId: "account-a-session" },
      { taskId: "account-a-task", imageUrl: "https://cdn.example.test/account-a.png" }
    ).task;
    const bHistoryTask = createGenerationResponse(
      { prompt: "Account B private task", imageSessionId: "account-b-session" },
      { taskId: "account-b-task", imageUrl: "https://cdn.example.test/account-b.png" }
    ).task;

    const fetchMock = await mountGenerationPage({
      workspaceAuth: true,
      backendHistoryHandler: async (_url, init) => {
        const authorization = new Headers(init?.headers).get("Authorization");
        if (authorization === "Bearer token-a") {
          return pendingAHistory.promise;
        }
        return generationJsonResponse({ tasks: [bHistoryTask] });
      },
      quotaHandler: async (_url, init) => {
        const authorization = new Headers(init?.headers).get("Authorization");
        if (authorization === "Bearer token-a") {
          return pendingAQuota.promise;
        }
        return generationJsonResponse({ remainingCredits: 41 });
      }
    });

    await settleGenerationPage();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          generationUrl(input).searchParams.get("limit") === "100" &&
          new Headers(init?.headers).get("Authorization") === "Bearer token-a"
      )
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          generationUrl(input).pathname.endsWith("/quota/me") &&
          new Headers(init?.headers).get("Authorization") === "Bearer token-a"
      )
    ).toBe(true);

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-workspace-auth-logout="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-workspace-auth-switch="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    await settleGenerationPage();

    expect(generationHost?.querySelector('[data-image-creator-history="true"]')).toBeTruthy();
    expect(generationHost?.textContent).not.toContain("Account A private task");
    expect(
      generationHost?.querySelector('[data-image-workbench-balance="true"]')?.textContent
    ).toContain("41");

    await act(async () => {
      pendingAHistory.resolve(generationJsonResponse({ tasks: [aHistoryTask] }));
      pendingAQuota.resolve(generationJsonResponse({ remainingCredits: 7 }));
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(generationHost?.querySelector('[data-image-creator-history="true"]')).toBeTruthy();
    expect(generationHost?.textContent).not.toContain("Account A private task");
    expect(
      generationHost?.querySelector('[data-image-workbench-balance="true"]')?.textContent
    ).toContain("41");
  });

  it("does not overwrite a prompt typed while continuation preparation is pending", async () => {
    const continuationRead = createDeferred<Response>();
    let contentReadCount = 0;
    const initialResult = createGenerationResponse(
      { prompt: "Restore only if the prompt is still empty" },
      { taskId: "task-prompt-race", imageUrl: "/assets/prompt-race/content" }
    );
    mockObjectUrlMethods(["blob:prompt-race-preview"]);
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "",
      initialResult,
      assetContentHandler: async () => {
        contentReadCount += 1;
        return contentReadCount <= 1
          ? privateImageResponse()
          : continuationRead.promise;
      }
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-continue-editing="true"]'
      )?.click();
      await Promise.resolve();
    });
    expect(generationAssetContentCalls(fetchMock)).toHaveLength(2);

    await setWorkspacePrompt("Keep my new draft");
    continuationRead.resolve(privateImageResponse());
    await continuationRead.promise;
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();

    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("Keep my new draft");
    expect(
      generationHost?.querySelector('[data-image-workbench-continuation-source="true"]')
    ).toBeTruthy();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("invalidates continuation reads when the active session changes", async () => {
    const continuationRead = createDeferred<Response>();
    let contentReadCount = 0;
    const initialResult = createGenerationResponse(
      { prompt: "Session A source prompt" },
      { taskId: "task-session-a", imageUrl: "/assets/session-a/content" }
    );
    mockObjectUrlMethods(["blob:session-a-preview"]);
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "",
      initialResult,
      assetContentHandler: async () => {
        contentReadCount += 1;
        return contentReadCount <= 1
          ? privateImageResponse()
          : continuationRead.promise;
      }
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-continue-editing="true"]'
      )?.click();
      await Promise.resolve();
    });
    expect(generationAssetContentCalls(fetchMock)).toHaveLength(2);

    await act(async () => {
      newDrawingButton()?.click();
      await Promise.resolve();
    });
    continuationRead.resolve(privateImageResponse());
    await continuationRead.promise;
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();

    expect(
      generationHost?.querySelector('[data-image-workbench-result-empty="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-workbench-continuation-source="true"]')
    ).toBeNull();
    expect(
      generationHost?.querySelector('[data-image-workbench-reference] img')
    ).toBeNull();
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("");
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("opens selected private workspace results with the resolved URL", async () => {
    const firstPrivateUrl = "/assets/workspace-private-one/content";
    const secondPrivateUrl = "/assets/workspace-private-two/content";
    const initialResult = createGenerationResponse(
      { prompt: "First private workspace result" },
      { taskId: "task-workspace-private-one", imageUrl: firstPrivateUrl }
    );
    mockObjectUrlMethods([
      "blob:workspace-private-one",
      "blob:workspace-private-one-thumbnail",
      "blob:workspace-private-two-thumbnail",
      "blob:workspace-private-two",
      "blob:workspace-private-one-refresh"
    ]);
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "Create the second private workspace result",
      initialResult,
      postHandler: async (_, payload) =>
        generationJsonResponse(
          createGenerationResponse(payload, {
            taskId: "task-workspace-private-two",
            imageUrl: secondPrivateUrl
          })
        ),
      assetContentHandler: async () => privateImageResponse()
    });

    await settleGenerationPage();
    const resultButton = () =>
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-result-image="true"]'
      );
    expect(resultButton()?.querySelector("img")?.getAttribute("src")).toBe(
      "blob:workspace-private-one"
    );
    expect(generationHost?.innerHTML).not.toContain(firstPrivateUrl);

    await act(async () => {
      resultButton()?.focus();
      resultButton()?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLImageElement>(
        '[data-image-preview-image="true"]'
      )?.getAttribute("src")
    ).toBe("blob:workspace-private-one");
    expect(generationHost?.innerHTML).not.toContain(firstPrivateUrl);

    const closePreview = async () => {
      await act(async () => {
        generationHost?.querySelector<HTMLButtonElement>(
          '[data-image-preview-close="true"]'
        )?.click();
        await Promise.resolve();
      });
      expect(document.activeElement).toBe(resultButton());
    };
    await closePreview();

    await act(async () => {
      resultButton()?.focus();
      resultButton()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLImageElement>(
        '[data-image-preview-image="true"]'
      )?.getAttribute("src")
    ).toBe("blob:workspace-private-one");
    await closePreview();

    await act(async () => {
      resultButton()?.focus();
      resultButton()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true })
      );
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLImageElement>(
        '[data-image-preview-image="true"]'
      )?.getAttribute("src")
    ).toBe("blob:workspace-private-one");
    await closePreview();

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-generate="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(
      resultButton()?.querySelector("img")?.getAttribute("src")
    ).toMatch(/^blob:/);
    expect(resultButton()?.querySelector("img")?.getAttribute("src")).not.toBe(
      "blob:workspace-private-one"
    );

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-version="1"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    const selectedVersionSource = resultButton()?.querySelector("img")?.getAttribute("src");
    expect(selectedVersionSource).toMatch(/^blob:/);

    await act(async () => {
      resultButton()?.click();
      await Promise.resolve();
    });
    expect(
      generationHost?.querySelector<HTMLImageElement>(
        '[data-image-preview-image="true"]'
      )?.getAttribute("src")
    ).toBe(selectedVersionSource);
    expect(generationHost?.innerHTML).not.toContain(firstPrivateUrl);
    expect(generationHost?.innerHTML).not.toContain(secondPrivateUrl);
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
  });

  it("keeps the selected success visible while a new version runs and selects the new success", async () => {
    const pendingResponse = createDeferred<Response>();
    const initialResult = createGenerationResponse(
      { prompt: "First version prompt" },
      { taskId: "task-retained-version-1", imageUrl: "https://cdn.example.test/retained-1.png" }
    );
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "Second version prompt",
      initialResult,
      postHandler: async (_, payload) =>
        pendingResponse.promise.then(() =>
          generationJsonResponse(
            createGenerationResponse(payload, {
              taskId: "task-retained-version-2",
              imageUrls: [
                "https://cdn.example.test/retained-2-1.png",
                "https://cdn.example.test/retained-2-2.png",
                "https://cdn.example.test/retained-2-3.png",
                "https://cdn.example.test/retained-2-4.png"
              ]
            })
          )
        )
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="4"]'
      )?.click();
      await Promise.resolve();
      generationHost?.querySelector<HTMLButtonElement>('[data-image-workbench-generate="true"]')?.click();
      await Promise.resolve();
    });
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image] img')?.getAttribute("src")
    ).toBe("https://cdn.example.test/retained-1.png");
    expect(generationHost?.querySelector('[data-image-workbench-generating-new="true"]')).toBeTruthy();
    expect(generationHost?.textContent).toContain("Generating a new version. Please wait.");
    expect(
      generationHost?.querySelector('[data-image-workbench-result-placeholders="4"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelectorAll('[data-image-workbench-result-placeholder]')
    ).toHaveLength(4);
    expect(
      Array.from(
        generationHost?.querySelectorAll<HTMLButtonElement>(
          '[data-image-generation-count-option]'
        ) ?? []
      ).every((option) => option.disabled)
    ).toBe(true);

    pendingResponse.resolve(
      new Response(null, { status: 204 })
    );
    await pendingResponse.promise;
    await settleGenerationPage();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(
      generationHost?.querySelector('[data-image-workbench-version="2"][data-image-workbench-version-selected="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image] img')?.getAttribute("src")
    ).toBe("https://cdn.example.test/retained-2-1.png");
    expect(
      generationHost?.querySelectorAll('[data-image-workbench-result-entry]')
    ).toHaveLength(4);
    expect(
      generationHost?.querySelector('[data-image-workbench-result-placeholder]')
    ).toBeNull();
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
  });

  it("shows compact checking placeholders for the frozen count while retaining the old result", async () => {
    const initialResult = createGenerationResponse(
      { prompt: "Previous checking result" },
      {
        taskId: "task-checking-previous",
        imageUrl: "https://cdn.example.test/checking-previous.png"
      }
    );
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialResult,
      reconcileStatuses: ["running"],
      postHandler: async () =>
        generationJsonResponse(
          { status: "in_progress", taskId: "task-checking", retryAfterMs: 2500 },
          202
        )
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="2"]'
      )?.click();
      await Promise.resolve();
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workbench-generate="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(
      generationHost?.querySelector('[data-image-workbench-result-checking="true"]')
    ).toBeTruthy();
    expect(generationHost?.textContent).toContain("Generating a new version. Please wait.");
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image] img')?.getAttribute("src")
    ).toBe("https://cdn.example.test/checking-previous.png");
    expect(
      generationHost?.querySelector('[data-image-workbench-result-placeholders="2"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelectorAll('[data-image-workbench-result-placeholder]')
    ).toHaveLength(2);
    expect(
      Array.from(
        generationHost?.querySelectorAll<HTMLButtonElement>(
          '[data-image-generation-count-option]'
        ) ?? []
      ).every((option) => option.disabled)
    ).toBe(true);
  });

  it("lets only the last continuation read win when versions are selected quickly", async () => {
    const firstContinuation = createDeferred<Response>();
    const secondContinuation = createDeferred<Response>();
    let nextContinuation: "first" | "second" | null = null;
    const initialResult = createGenerationResponse(
      { prompt: "Race version one" },
      { taskId: "task-race-version-1", imageUrl: "/assets/race-version-1/content" }
    );
    mockObjectUrlMethods([
      "blob:race-version-1",
      "blob:race-version-2",
      "blob:race-version-1-refresh",
      "blob:race-version-2-refresh"
    ]);
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "Race version one",
      initialResult,
      postHandler: async (_, payload) =>
        generationJsonResponse(
          createGenerationResponse(payload, {
            taskId: "task-race-version-2",
            imageUrl: "/assets/race-version-2/content"
          })
        ),
      assetContentHandler: async (url) => {
        const path = url.pathname;
        if (path === "/api/assets/race-version-1/content" && nextContinuation === "first") {
          nextContinuation = null;
          return firstContinuation.promise;
        }
        if (path === "/api/assets/race-version-2/content" && nextContinuation === "second") {
          nextContinuation = null;
          return secondContinuation.promise;
        }
        return privateImageResponse();
      }
    });

    const prompt = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-workbench-prompt="true"]'
    );
    if (prompt) {
      await act(async () => {
        prompt.value = "Create race version two";
        prompt.dispatchEvent(new Event("input", { bubbles: true }));
        await Promise.resolve();
      });
    }
    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>('[data-image-workbench-generate="true"]')?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    const versions = generationHost?.querySelectorAll<HTMLButtonElement>(
      "[data-image-workbench-version]"
    );
    expect(versions).toHaveLength(2);
    expect(
      generationHost?.querySelector('[data-image-workbench-version="1"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-workbench-version="2"]')
    ).toBeTruthy();

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>('[data-image-workbench-version="1"]')?.click();
      await Promise.resolve();
    });
    await act(async () => {
      nextContinuation = "first";
      generationHost?.querySelector<HTMLButtonElement>('[data-image-workbench-continue-editing="true"]')?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>('[data-image-workbench-version="2"]')?.click();
      await Promise.resolve();
    });
    await act(async () => {
      nextContinuation = "second";
      generationHost?.querySelector<HTMLButtonElement>('[data-image-workbench-continue-editing="true"]')?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    secondContinuation.resolve(privateImageResponse());
    await secondContinuation.promise;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();
    firstContinuation.resolve(privateImageResponse());
    await firstContinuation.promise;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();

    expect(
      generationHost?.querySelector('[data-image-workbench-continuation-source="true"]')?.textContent
    ).toContain("version 2");
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
  });

  it("retains the previous selected version after a new version fails", async () => {
    const initialResult = createGenerationResponse(
      { prompt: "Previous successful prompt" },
      { taskId: "task-failed-version-1", imageUrl: "https://cdn.example.test/failed-1.png" }
    );
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "New failing prompt",
      initialResult,
      postHandler: async () =>
        generationJsonResponse(
          { message: "safe failure", code: "IMAGE_GENERATION_FAILED", retryable: false },
          500
        )
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>('[data-image-workbench-generate="true"]')?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image] img')?.getAttribute("src")
    ).toBe("https://cdn.example.test/failed-1.png");
    expect(generationHost?.querySelector('[data-image-workbench-result-latest-failed="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-workbench-result-versions="true"]')).toBeNull();
  });

  it("preserves a non-empty prompt and asks before replacing an existing reference", async () => {
    const initialResult = createGenerationResponse(
      { prompt: "Original generated prompt" },
      { taskId: "task-confirm-source", imageUrl: "/assets/confirm-source/content" }
    );
    initialResult.assets[0]!.thumbnailUrl = "/generated-assets/confirm-thumb.png";
    mockObjectUrlMethods(["blob:confirm-preview"]);
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "Keep my draft",
      initialResult,
      initialReferenceImage: {
        dataUrl: "data:image/jpeg;base64,b2xk",
        mimeType: "image/jpeg",
        name: "old.jpg",
        originalBytes: 100,
        compressedBytes: 80
      },
      assetContentHandler: async () => privateImageResponse()
    });

    const beforeContentReads = generationAssetContentCalls(fetchMock).length;
    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>('[data-image-workbench-continue-editing="true"]')?.click();
      await Promise.resolve();
    });
    expect(generationHost?.querySelector('[role="dialog"]')).toBeTruthy();
    expect(generationAssetContentCalls(fetchMock)).toHaveLength(beforeContentReads);

    await act(async () => {
      const confirmButton = Array.from(
        generationHost?.querySelectorAll<HTMLButtonElement>('[role="dialog"] button') ?? []
      ).find((button) => button.textContent?.includes("Replace"));
      confirmButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await settleGenerationPage();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();
    expect(generationAssetContentCalls(fetchMock)).toHaveLength(beforeContentReads + 1);
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>('[data-image-workbench-prompt="true"]')?.value
    ).toBe("Keep my draft");
    expect(
      generationHost?.querySelector<HTMLImageElement>('[data-image-workbench-reference] img')?.getAttribute("src")
    ).toContain("Y29udGludWF0aW9u");
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("keeps workspace historical-only Assets out of successful Creator results", async () => {
    const initialResult = createGenerationResponse({
      prompt: "A history-shaped result"
    });
    initialResult.assets = initialResult.assets.map((asset, index) => ({
      ...asset,
      id: `${initialResult.task.id}-history-asset-${index}`
    }));

    await mountGenerationPage({ mode: "workspace", initialResult });

    expect(generationHost?.querySelector('[data-image-workbench-result-success="true"]')).toBeNull();
    expect(generationHost?.querySelector('[data-image-workbench-result-failed="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-workbench-task-link="true"]')).toBeNull();
    expect(
      generationHost?.querySelector('[data-image-workbench-asset-link="true"]')
    ).toBeNull();
  });

  it("keeps historical fallback display state mode-gated without mutating the source entry", () => {
    const result = createGenerationResponse({ prompt: "Historical fallback" });
    result.assets = result.assets.map((asset, index) => ({
      ...asset,
      id: `${result.task.id}-history-asset-${index}`
    }));
    const entry: ImageStreamEntry = {
      id: "historical-entry",
      prompt: result.task.prompt,
      modelName: "Image Model",
      modelId: "image-model",
      aspectRatio: "1:1",
      mode: "text-to-image",
      referenceImage: null,
      requestedCount: 1,
      status: "succeeded",
      result,
      error: null
    };

    const quickEntry = resolveImageEntryDisplayState(entry, {
      allowHistoricalFallback: true
    });
    const workspaceEntry = resolveImageEntryDisplayState(entry, {
      allowHistoricalFallback: false
    });

    expect(quickEntry.status).toBe("succeeded");
    expect(quickEntry.result).toBe(result);
    expect(deriveImageResultBatches([quickEntry])).toHaveLength(1);
    expect(workspaceEntry).toMatchObject({ status: "failed", result: null });
    expect(deriveImageResultBatches([workspaceEntry])).toEqual([]);
    expect(entry.status).toBe("succeeded");
    expect(entry.result).toBe(result);
  });

  it("keeps a prior real workspace batch when a newer historical-only entry fails safely", () => {
    const realEntry = createVersionEntry("succeeded", 100);
    const historicalResult = createGenerationResponse({
      prompt: "Historical latest"
    });
    historicalResult.assets = historicalResult.assets.map((asset, index) => ({
      ...asset,
      id: `${historicalResult.task.id}-history-asset-${index}`
    }));
    const historicalEntry: ImageStreamEntry = {
      ...realEntry,
      id: "historical-latest",
      prompt: historicalResult.task.prompt,
      result: historicalResult
    };
    const displayEntries = [realEntry, historicalEntry].map((entry) =>
      resolveImageEntryDisplayState(entry, { allowHistoricalFallback: false })
    );

    expect(displayEntries[0]?.status).toBe("succeeded");
    expect(displayEntries[1]).toMatchObject({ status: "failed", result: null });
    expect(deriveImageResultBatches(displayEntries)).toHaveLength(1);
    expect(deriveImageResultBatches(displayEntries)[0]?.taskId).toBe(realEntry.result?.task.id);
  });

  it("keeps quick historical owner-readable output displayable without inventing a saved Asset", async () => {
    const historicalResult = createGenerationResponse({
      prompt: "Switch mode history"
    });
    historicalResult.assets = historicalResult.assets.map((asset, index) => ({
      ...asset,
      id: `${historicalResult.task.id}-history-asset-${index}`
    }));

    await mountGenerationPage({ mode: "quick", initialResult: historicalResult });
    expect(generationHost?.querySelector('[data-image-workbench-result-success="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-workbench-result-unavailable="true"]')).toBeNull();
    expect(generationHost?.querySelector('[data-image-workbench-asset-link="true"]')).toBeNull();
    expect(generationHost?.textContent).not.toContain("View work");
    expect(generationHost?.textContent).not.toContain("Saved");
  });

  it("keeps legacy URL mode parsing separate from the unified Creator presentation and submit path", () => {
    const html = renderImageWorkspace({ initialPrompt: "keep this prompt" });

    expect(html).toContain('data-image-creator-workspace="true"');
    expect(html).not.toContain('data-image-mobile-mode="quick"');
    expect(html).not.toContain('data-image-mobile-mode="workbench"');
    expect(imagePageSource).toContain('const isQuickCreateMode = creationMode === "quick";');
    expect(imagePageSource).toContain("window.addEventListener(\"popstate\"");
    expect(imagePageSource).toContain("function handleGenerateSubmit");
    expect(imagePageSource).toContain("event.preventDefault()");
    expect(html).toContain("keep this prompt");
  });

  it("retains the M1 prompt and Android UUID safeguards", () => {
    expect(imagePageSource).toContain("data-image-prompt-clears-after-fetch");
    expect(imagePageSource).toContain("data-image-prompt-restores-on-failure");
    expect(imagePageSource).toContain("createSecureUuid");
    expect(imagePageSource).toContain("imagePreFetchFailureMessage");
  });

  it("keeps the desktop Creator quiet with left input and right result", () => {
    const html = renderImageWorkspace();

    expect(html).toContain('data-image-creator-main="left-input-right-result"');
    expect(html).toContain('data-image-creator-input="true"');
    expect(html).toContain('data-image-creator-result="true"');
    expect(html).toContain('data-image-generate-button="true"');
    expect(html).not.toContain('data-image-secondary-sidebar="true"');
  });

  it("keeps the shared shell title while omitting a Creator-local sidebar", () => {
    const html = renderImageWorkspace({}, "zh-CN");

    expect(html).toContain("图像创作");
    expect(html).not.toContain('data-image-secondary-sidebar="true"');
  });

  it("keeps the compact composer in-flow without an inspiration carousel", () => {
    const html = renderImageWorkspace();

    expect(html).toContain("h-full");
    expect(html).toContain("min-h-0");
    expect(html).not.toContain("md:h-[100dvh]");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain('data-image-main-scroll="true"');
    expect(html).toContain('data-image-mobile-single-scroll="true"');
    expect(html).toContain('data-image-scroll-policy="submitted-entry-only"');
    expect(html).toContain('data-image-mobile-full-bleed="true"');
    expect(html).toContain('data-image-mobile-outer-frame="absent"');
    expect(html).toContain('data-image-mobile-rounded-shell="absent"');
    expect(html).not.toContain('data-image-inspiration-scroll="true"');
    expect(html).not.toContain('data-image-inspiration-carousel="true"');
    expect(html).not.toContain('data-image-prompt-card-thumbnails="true"');
    expect(html).not.toContain("min-w-max");
    expect(html).toContain('data-image-composer-prompt="true"');
    expect(html).not.toContain("fixed inset-x-0");
  });

  it("keeps the mobile empty composer ahead of restrained result guidance and expands parameters in place", async () => {
    await mountGenerationPage({ mobile: true });

    const composer = generationHost?.querySelector<HTMLElement>(
      '[data-image-mobile-compact-composer="true"]'
    );
    const emptyResult = generationHost?.querySelector<HTMLElement>(
      '[data-image-workbench-result-empty="true"]'
    );
    expect(composer).toBeTruthy();
    expect(emptyResult).toBeTruthy();
    expect(
      (composer?.compareDocumentPosition(emptyResult ?? document.body) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(composer?.querySelector('[data-image-composer-prompt="true"]')).toBeTruthy();
    expect(composer?.querySelector('[data-image-mobile-reference-input="true"]')).toBeTruthy();
    expect(composer?.querySelector('[data-image-workbench-model="true"]')).toBeTruthy();
    expect(composer?.querySelector('[data-image-mobile-parameters-toggle="true"]')).toBeTruthy();
    expect(composer?.querySelector('[data-image-mobile-generate-button="true"]')).toBeTruthy();
    const compactControls = composer?.querySelector<HTMLElement>(
      '[data-image-mobile-compact-controls="true"]'
    );
    expect(compactControls?.textContent).toContain("Reference");
    expect(compactControls?.textContent).toContain("Model");
    expect(compactControls?.textContent).toContain("Parameters");
    expect(compactControls?.textContent).toContain("Generate");
    expect(compactControls?.className).toContain("min-w-0");
    expect(compactControls?.className).toContain("gap-1");
    expect(composer?.querySelector('[data-image-mobile-parameters="true"]')).toBeNull();
    const compactPrompt = composer?.querySelector<HTMLTextAreaElement>(
      '[data-image-mobile-compact-prompt="true"]'
    );
    expect(compactPrompt?.rows).toBe(2);
    expect(compactPrompt?.className).toContain("min-h-16");

    await act(async () => {
      composer?.querySelector<HTMLButtonElement>(
        '[data-image-mobile-parameters-toggle="true"]'
      )?.click();
      await Promise.resolve();
    });
    expect(composer?.querySelector('[data-image-mobile-parameters="true"]')).toBeTruthy();
    const mobileAspectControl = composer?.querySelector<HTMLElement>(
      '[data-image-parameter-control="aspect"]'
    );
    expect(mobileAspectControl).toBeTruthy();
    expect(mobileAspectControl?.className).toContain("rounded-xl");
    expect(mobileAspectControl?.className).toContain("focus-within:ring-2");
    expect(
      mobileAspectControl?.querySelector<HTMLSelectElement>(
        '[data-image-workbench-size="true"]'
      )?.className
    ).toContain("appearance-none");
    expect(
      mobileAspectControl
        ?.querySelector('[data-image-parameter-chevron="true"]')
        ?.getAttribute("class")
    ).toContain("pointer-events-none");
    expect(
      composer?.querySelector(
        '[data-image-generation-count-picker="true"][data-image-parameter-family="true"]'
      )
    ).toBeTruthy();
  });

  it("keeps the mobile model control readable with a selected model", async () => {
    await mountGenerationPage({
      mobile: true,
      models: [
        imageModel({
          name: "Very Long Image Model Name",
          displayName: "Very Long Image Model Name"
        }),
        imageModel({
          id: "model_image_two",
          slug: "image-model-two",
          modelId: "image-model-two",
          name: "Second Image Model",
          displayName: "Second Image Model",
          sortOrder: 1
        })
      ]
    });

    const control = generationHost?.querySelector<HTMLElement>(
      '[data-image-mobile-model-control="true"]'
    );
    const select = control?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-model="true"]'
    );
    const selectedValue = control?.querySelector<HTMLElement>(
      '[data-image-mobile-model-value="true"]'
    );
    const separator = control?.querySelector<HTMLElement>(
      '[data-image-mobile-model-separator="true"]'
    );
    const chevron = control?.querySelector<HTMLElement>(
      '[data-image-parameter-chevron="true"]'
    );
    expect(select).toBeTruthy();
    expect(selectedValue?.textContent).toContain("Very Long Image Model Name");
    expect(selectedValue?.className).toContain("truncate");
    expect(selectedValue?.className).not.toContain("hidden");
    expect(control?.className).toContain("min-w-0");
    expect(control?.className).toContain("flex-1");
    expect(control?.className).toContain("pr-7");
    expect(control?.getAttribute("data-image-parameter-focus-surface")).toBe("wrapper");
    expect(separator).toBeTruthy();
    expect(separator?.textContent?.trim()).toBe("·");
    expect(separator?.className).not.toContain("hidden");
    expect(separator?.className).not.toContain("sm:inline");
    expect(separator?.previousElementSibling?.getAttribute("data-image-mobile-model-base-label")).toBe(
      "true"
    );
    expect(separator?.nextElementSibling?.getAttribute("data-image-mobile-model-value")).toBe(
      "true"
    );
    expect(chevron).toBeTruthy();
    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
    expect(chevron?.getAttribute("class")).toContain("pointer-events-none");
    expect(
      control?.querySelector('[data-image-mobile-model-base-label="true"]')?.textContent
    ).toBe("Model");
    expect(
      control?.querySelector('[data-image-mobile-model-label="true"]')?.textContent
    ).toContain("Model");
    expect(select?.value).toBe("image-model");
    expect(Array.from(select?.options ?? []).map((option) => option.value)).toEqual([
      "image-model",
      "image-model-two"
    ]);
    expect(select?.getAttribute("aria-label")).toContain("Very Long Image Model Name");
    expect(select?.getAttribute("title")).toContain("Very Long Image Model Name");
  });

  it("keeps the unavailable mobile model control semantic instead of arrow-only", async () => {
    await mountGenerationPage({ mobile: true, models: [] });

    const control = generationHost?.querySelector<HTMLElement>(
      '[data-image-mobile-model-control="true"]'
    );
    const select = control?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-model="true"]'
    );
    expect(
      control?.querySelector('[data-image-mobile-model-base-label="true"]')?.textContent
    ).toBe("Model");
    expect(control?.getAttribute("title")).toBe("No image model available");
    expect(select?.getAttribute("aria-label")).toBe("No image model available");
    expect(select?.disabled).toBe(true);
  });

  it("keeps all workflow tabs in an independent horizontal scroller", async () => {
    await mountGenerationPage({ mobile: true });

    const scroller = generationHost?.querySelector<HTMLElement>(
      '[data-image-workflow-scroller="true"]'
    );
    const tabs = scroller?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(scroller?.className).toContain("overflow-x-auto");
    expect(scroller?.className).toContain("overscroll-x-contain");
    expect(tabs).toHaveLength(4);
    expect(tabs?.[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs?.[1]?.disabled).toBe(false);
    expect(tabs?.[2]?.disabled).toBe(false);
    expect(tabs?.[3]?.disabled).toBe(false);
  });

  it("keeps reference compression feedback visible in the mobile composer", async () => {
    mockReferenceCompressionBrowser();
    let pendingImage: {
      naturalWidth: number;
      naturalHeight: number;
      width: number;
      height: number;
      onload: (() => void) | null;
      onerror: (() => void) | null;
    } | null = null;

    class DeferredImage {
      naturalWidth = 800;
      naturalHeight = 600;
      width = 800;
      height = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        pendingImage = this;
      }
    }

    Object.defineProperty(window, "Image", {
      configurable: true,
      value: DeferredImage
    });
    await mountGenerationPage({ mobile: true });

    const input = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-mobile-reference-input="true"]'
    );
    const file = new File(["reference"], "reference.png", { type: "image/png" });
    Object.defineProperty(input ?? document.createElement("input"), "files", {
      configurable: true,
      value: [file]
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();
    expect(pendingImage).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-mobile-reference-compressing="true"]')
    ).toBeTruthy();

    await act(async () => {
      pendingImage?.onload?.();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(
      generationHost?.querySelector('[data-image-mobile-reference-compressing="true"]')
    ).toBeNull();
  });

  it("uses an existing prompt card for random inspiration", async () => {
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Keep this draft until inspiration is chosen",
      publicSettings: {
        imagePromptCards: JSON.stringify([
          { title: "Configured", prompt: "Configured existing prompt" }
        ])
      }
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-random-inspiration="true"]'
      )?.click();
      await Promise.resolve();
    });
    const promptValue = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-composer-prompt="true"]'
    )?.value;
    const fallbackPrompts = imageInspirationPresets.map((card) =>
      createTranslator("en-US")(card.promptKey)
    );

    expect(["Configured existing prompt", ...fallbackPrompts]).toContain(promptValue);
    expect(promptValue).not.toBe("Keep this draft until inspiration is chosen");
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("does not invent prompt optimization or advanced settings without a real capability", () => {
    const html = renderImageWorkspace();

    expect(html).not.toContain('data-image-prompt-optimize="true"');
    expect(html).not.toContain('data-image-advanced-settings="true"');
    expect(html.match(/>Count</g)).toHaveLength(1);
  });

  it("keeps mobile Enter as newline and desktop Enter as generate", () => {
    expect(
      shouldSubmitImagePromptOnEnter({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        isMobileLayout: true
      })
    ).toBe(false);
    expect(
      shouldSubmitImagePromptOnEnter({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        isMobileLayout: false
      })
    ).toBe(true);
    expect(
      shouldSubmitImagePromptOnEnter({
        key: "Enter",
        shiftKey: true,
        isComposing: false,
        isMobileLayout: false
      })
    ).toBe(false);
    expect(
      shouldSubmitImagePromptOnEnter({
        key: "Enter",
        shiftKey: false,
        isComposing: true,
        isMobileLayout: false
      })
    ).toBe(false);
  });

  it("shows only enabled image-capable models with icons and current highlighting", () => {
    const html = renderImageWorkspace({
      initialModels: [
        imageModel({ displayName: "Enabled Image Model", iconText: "IM" }),
        imageModel({
          id: "disabled_image",
          name: "Disabled Image Model",
          displayName: "Disabled Image Model",
          slug: "disabled-image-model",
          modelId: "disabled-image-model",
          enabled: false
        }),
        imageModel({
          id: "chat_model",
          name: "Chat Model",
          displayName: "Chat Model",
          slug: "chat-model",
          provider: "SUB2API",
          modelId: "chat-model",
          capability: "chat",
          group: "free",
          tags: ["chat"]
        })
      ]
    });

    expect(html).toContain("Enabled Image Model");
    expect(html).toContain('data-model-icon="true"');
    expect(html).toContain('data-image-model-current="true"');
    expect(html).toContain('data-image-workbench-model="true"');
    expect(html).not.toContain("Disabled Image Model");
    expect(html).not.toContain("Chat Model");
  });

  it("keeps fallback inspiration data out of the unified Creator presentation", () => {
    const html = renderImageWorkspace();

    expect(imageInspirationPresets).toHaveLength(6);
    expect(imageInspirationPresets[0]).toMatchObject({
      id: expect.any(String),
      titleKey: expect.any(String),
      categoryKey: expect.any(String),
      promptKey: expect.any(String),
      aspectRatio: expect.any(String),
      accentClassName: expect.any(String),
      coverClassName: expect.any(String)
    });
    expect(imagePageSource).toContain("publicSettings?.imagePromptCards");
    expect(imagePageSource).not.toContain("publicSettings?.workspacePromptCards");
    expect(html).toContain('data-image-mobile-inspiration-disabled="true"');
    expect(html).not.toContain('data-use-inspiration-prompt="true"');
    expect(html).not.toContain("Clean studio product hero");
  });

  it("does not surface configured image cards as a fake unified Creator workflow", async () => {
    const configuredCards = [
      {
        title: "Configured image one",
        description: "First configured visual direction.",
        prompt: "Configured prompt one"
      },
      {
        title: "Configured image two",
        description: "Second configured visual direction.",
        prompt: "Configured prompt two"
      },
      {
        title: "Configured image three",
        description: "Third configured visual direction.",
        prompt: "Configured prompt three"
      },
      {
        title: "Configured image four",
        description: "This card is beyond the visible limit.",
        prompt: "Configured prompt four"
      }
    ];
    const fetchMock = await mountGenerationPage({
      mobile: true,
      publicSettings: { imagePromptCards: JSON.stringify(configuredCards) }
    });

    expect(generationHost?.querySelector('[data-image-mobile-inspiration-disabled="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-inspiration-carousel="true"]')).toBeNull();
    expect(generationHost?.querySelector<HTMLTextAreaElement>('[data-image-composer-prompt="true"]')?.value).toBe("A quiet reading room");
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("keeps optional imageUrl inspiration cards unavailable in S2-C", async () => {
    await mountGenerationPage({
      mobile: true,
      publicSettings: { imagePromptCards: JSON.stringify([{ title: "Visual product hero", prompt: "Create the visual product hero", imageUrl: "https://cdn.example.com/product-hero.jpg" }]) }
    });

    expect(generationHost?.querySelector('[data-image-mobile-inspiration-disabled="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-inspiration-carousel="true"]')).toBeNull();
    expect(generationHost?.querySelector('[data-image-preview-dialog="true"]')).toBeNull();
  });

  it("does not create a fallback inspiration card when an image prompt card is configured", async () => {
    await mountGenerationPage({
      mobile: true,
      publicSettings: {
        imagePromptCards: JSON.stringify([
          {
            title: "Fallback product hero",
            description: "Fallback description",
            prompt: "Fallback prompt",
            imageUrl: "https://cdn.example.com/fallback.jpg"
          }
        ])
      }
    });

    expect(generationHost?.querySelector('[data-image-inspiration-carousel="true"]')).toBeNull();
    expect(generationHost?.querySelector('[data-image-mobile-inspiration-disabled="true"]')).toBeTruthy();
  });

  it("does not expose inspiration-card navigation as an unavailable workflow", async () => {
    await mountGenerationPage({ mobile: true, publicSettings: { imagePromptCards: JSON.stringify([{ title: "Portrait", prompt: "Portrait prompt" }, { title: "Square", prompt: "Square prompt" }]) } });
    expect(generationHost?.querySelector('[data-image-inspiration-carousel="true"]')).toBeNull();
    expect(generationHost?.querySelector('[data-image-mobile-inspiration-disabled="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-preview-dialog="true"]')).toBeNull();
  });

  it("keeps a configured single inspiration card unavailable without auto-advance", async () => {
    await mountGenerationPage({ publicSettings: { imagePromptCards: JSON.stringify([{ title: "Only card", prompt: "Only prompt" }]) } });
    expect(generationHost?.querySelector('[data-image-inspiration-carousel="true"]')).toBeNull();
    expect(imagePageSource).not.toContain("setInterval");
  });

  it("keeps an explicit empty imagePromptCards array empty without falling back", async () => {
    await mountGenerationPage({
      publicSettings: { imagePromptCards: "[]" }
    });

    expect(generationHost?.querySelector('[data-image-inspiration-carousel="true"]')).toBeNull();
    expect(generationHost?.querySelector('[data-image-quick-inspiration="true"]')).toBeNull();
    expect(generationHost?.textContent).not.toContain("Clean studio product hero");
    expect(generationHost?.querySelector('[data-image-composer-prompt="true"]')).toBeTruthy();
  });

  it("renders upload errors as a dismissible toast", () => {
    const html = renderImageWorkspace({
      initialError: "Reference image is too large."
    });

    expect(html).toContain('data-image-error-toast="true"');
    expect(html).toContain('data-image-error-auto-dismiss="true"');
    expect(html).toContain('data-image-error-timeout-ms="10000"');
    expect(html).toContain("Close error");
  });

  it("keeps image history available as a utility instead of a Creator-local record rail", () => {
    const html = renderImageWorkspace({
      initialPrompt: "A quiet reading room",
      initialIsLoading: true
    });

    expect(html).toContain('data-image-creator-history="true"');
    expect(html).toContain('href="/image/history"');
    expect(html).not.toContain('data-image-history-sessions="true"');
    expect(html).not.toContain('data-image-secondary-sidebar="true"');
  });

  it("renders stable Creator result placeholders after generation starts", () => {
    const html = renderImageWorkspace({
      initialPrompt: "A quiet reading room",
      initialIsLoading: true
    });

    expect(html).toContain('data-image-creator-result="true"');
    expect(html).toContain('data-image-ai-status="loading"');
    expect(html).toContain('data-image-ai-loading="true"');
    expect(html).toContain('data-image-loading-skeleton="true"');
    expect(html).toContain('data-image-workbench-result-placeholders="1"');
    expect(html).not.toContain('data-image-user-message-meta="true"');
    expect(html).not.toContain("Text to image");
    expect(html).not.toContain('data-image-empty-state="true"');
  });

  it("keeps the reference thumbnail in the compact Creator input while loading", () => {
    const html = renderImageWorkspace({
      initialPrompt: "Restyle this room",
      initialIsLoading: true,
      initialGenerationMode: "image-to-image",
      initialReferenceImage: {
        dataUrl: "data:image/jpeg;base64,cm9vbQ==",
        mimeType: "image/jpeg",
        name: "room.jpg",
        originalBytes: 2048,
        compressedBytes: 1024
      }
    });

    expect(html).toContain('data-reference-image-preview="true"');
    expect(html).toContain("room.jpg");
    expect(html).not.toContain("Image to image");
    expect(html).not.toContain("compressed:");
    expect(html).not.toContain("已自动压缩");
  });

  it("renders a successful AI image result as the selected Creator hero", () => {
    const html = renderImageWorkspace({
      initialPrompt: "A quiet reading room",
      initialResult: {
        task: {
          id: "task_1",
          userId: "user_1",
          type: "image",
          status: "succeeded",
          modelId: "image-model",
          prompt: "A quiet reading room",
          input: { size: "1024x1024", count: 1 },
          output: { images: ["https://cdn.example.com/image.png"] },
          costCredits: 2,
          errorMessage: null,
          createdAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:10.000Z",
          completedAt: "2026-06-18T00:00:10.000Z"
        },
        assets: [
          {
            id: "asset_1",
            userId: "user_1",
            taskId: "task_1",
            type: "image",
            url: "https://cdn.example.com/image.png",
            thumbnailUrl: null,
            title: "A quiet reading room",
            metadata: null,
            createdAt: "2026-06-18T00:00:00.000Z",
            taskPrompt: "A quiet reading room"
          }
        ]
      }
    });

    expect(html).toContain('data-image-ai-status="succeeded"');
    expect(html).toContain('data-image-ai-result="true"');
    expect(html).toContain('data-image-creator-result-hero="true"');
    expect(html).toContain("https://cdn.example.com/image.png");
    expect(html).toContain("object-contain");
    expect(html).toContain('data-image-workbench-asset-link="true"');
    expect(html).not.toContain("Open original");
    expect(html).not.toContain('data-image-open-original="true"');
    expect(html).not.toContain("Task status");
    expect(html).not.toContain("Succeeded");
    expect(html).toContain('href="/tasks/task_1"');
    expect(html).toContain('href="/assets/asset_1"');
    expect(html).not.toContain('data-image-conversation-stream="true"');
  });

  it("renders generation failure in the Creator result area", () => {
    const html = renderImageWorkspace({
      initialPrompt: "A quiet reading room",
      initialError: "Generation failed. Please try again."
    });

    expect(html).toContain('data-image-creator-result="true"');
    expect(html).toContain('data-image-ai-status="failed"');
    expect(html).toContain('data-image-ai-error="true"');
    expect(html).toContain("Generation failed. Please try again.");
  });

  it("keeps logged-out generation guarded without changing request flow", () => {
    const html = renderImageWorkspace({
      initialToken: null,
      initialPrompt: "A quiet reading room"
    });

    expect(html).toContain('data-image-generate-button="true"');
    expect(html).toContain('data-image-logged-out-guard="toast-no-generate"');
    expect(html).toContain('data-image-login-required-hint="true"');
    expect(html).toContain("Please sign in before generating images");
    expect(html).toContain('data-image-generate-request-flow="unchanged"');
    expect(html).toContain('data-creation-surface-option="video"');
    expect(html).toContain('href="/video"');
    expect(html).not.toContain('data-creation-surface-option="ppt"');
  });

  it("documents drag upload and invalid-file toast behavior", () => {
    const html = renderImageWorkspace({
      initialError: "Reference image must be PNG, JPG, or WebP."
    });

    expect(html).toContain('data-image-drag-upload="reference-image"');
    expect(html).toContain('data-image-drag-active="false"');
    expect(html).toContain('data-image-drag-uses-existing-validation="true"');
    expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(html).toContain('data-image-error-toast="true"');
    expect(html).toContain("Reference image must be PNG, JPG, or WebP.");
  });

  it("guards concurrent image session creation with a ref-based lock", () => {
    expect(imagePageSource).toContain(
      "const creatingImageSessionRef = useRef(false)"
    );
    expect(imagePageSource).toContain(
      "if (creatingImageSessionRef.current)"
    );
    expect(imagePageSource).toContain(
      "creatingImageSessionRef.current = true"
    );
    expect(imagePageSource).toContain(
      "creatingImageSessionRef.current = false"
    );
  });

  it("reuses the current empty image session instead of creating a new one", () => {
    expect(imagePageSource).toContain(
      "isCurrentSessionEmpty = currentEntries.length === 0"
    );
    expect(imagePageSource).toContain(
      "isCurrentSessionEmpty"
    );
  });

  it("uses generateImageSessionTitle for short image session titles", () => {
    expect(imagePageSource).toContain(
      "generateImageSessionTitle"
    );
  });

  it("passes titleGenerator option to updateImageSessionEntries", () => {
    expect(imagePageSource).toContain(
      "titleGenerator"
    );
  });

  it("renders ConfirmDialog for image draft discard protection", () => {
    expect(imagePageSource).toContain(
      "ConfirmDialog"
    );
    expect(imagePageSource).toContain(
      "isDiscardImageDraftOpen"
    );
    expect(imagePageSource).toContain(
      'title={t("multimodal.image.confirmDiscardTitle")}'
    );
    expect(imagePageSource).toContain(
      'message={t("multimodal.image.confirmDiscardMessage")}'
    );
  });

  it("detects the active workflow draft before creating", () => {
    expect(imagePageSource).toContain("const hasDraft = isTitleCoverWorkflow");
    expect(imagePageSource).toContain("prompt.trim().length > 0");
  });

  it("shows confirm dialog when image draft exists before creating", () => {
    expect(imagePageSource).toContain(
      "if (hasDraft)"
    );
    expect(imagePageSource).toContain(
      "setIsDiscardImageDraftOpen(true)"
    );
  });

  it("prevents double image dialog via isDiscardDraftOpenRef", () => {
    expect(imagePageSource).toContain(
      "isDiscardDraftOpenRef.current"
    );
  });

  it("stops the current run before starting a new drawing", () => {
    expect(imagePageSource).toContain("function stopImageGenerationRun()");
    expect(imagePageSource).toContain("imageGenerationAbortControllerRef.current?.abort()");
  });

  it("projects a selected Title Cover result into a composed preview and keeps visual candidates selectable", async () => {
    const fetchMock = await mountGenerationPage({
      assetContentHandler: async () =>
        new Response(new Blob(["visual"], { type: "image/png" }), {
          status: 200,
          headers: { "Content-Type": "image/png" }
        }),
      postHandler: async (index, payload) =>
        generationJsonResponse(
          createGenerationResponse(payload, {
            taskId: `task-title-cover-composition-${index}`,
            imageUrls: [
              "/assets/title-cover-visual-a/content",
              "/assets/title-cover-visual-b/content"
            ],
            assetIds: ["title-cover-visual-a", "title-cover-visual-b"]
          })
        )
    });

    await activateTitleCoverWorkflow();
    await fillTitleCoverDraft("Exact title", "Exact main copy");
    const secondary = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-title-cover-secondary-copy="true"]'
    );
    await act(async () => {
      if (secondary) setControlledFormValue(secondary, "Exact secondary copy");
      await Promise.resolve();
    });
    await clickTitleCoverGenerateButton();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationHost?.querySelector('[data-image-title-cover-composed-preview="true"]')).toBeTruthy();
    expect(generationHost?.textContent).toContain("Visual base candidates");
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-title-cover-download="true"]'
      )
    ).toBeTruthy();

    const candidateButtons = generationHost?.querySelectorAll<HTMLButtonElement>(
      '[data-image-workbench-result-entry]'
    );
    expect(candidateButtons).toHaveLength(2);
    const firstSource = generationHost
      ?.querySelector('[data-image-title-cover-composed-preview="true"]')
      ?.getAttribute("data-image-title-cover-source");
    await act(async () => {
      candidateButtons?.[1]?.click();
      await Promise.resolve();
    });
    const secondSource = generationHost
      ?.querySelector('[data-image-title-cover-composed-preview="true"]')
      ?.getAttribute("data-image-title-cover-source");
    expect(firstSource).toBe("/assets/title-cover-visual-a/content");
    expect(secondSource).toBe("/assets/title-cover-visual-b/content");

    const postCountBeforeCopyEdit = generationPostCalls(fetchMock).length;
    const mainCopy = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-title-cover-main-copy="true"]'
    );
    await act(async () => {
      if (mainCopy) setControlledFormValue(mainCopy, "Edited exact main copy");
      await Promise.resolve();
    });
    expect(generationPostCalls(fetchMock)).toHaveLength(postCountBeforeCopyEdit);
    expect(generationTaskDetailCalls(fetchMock)).toHaveLength(0);
  });

  it("keeps Title Cover typography edits local after a result without a second generation", async () => {
    const fetchMock = await mountGenerationPage({
      assetContentHandler: async () =>
        new Response(new Blob(["visual"], { type: "image/png" }), {
          status: 200,
          headers: { "Content-Type": "image/png" }
        }),
      postHandler: async (index, payload) =>
        generationJsonResponse(
          createGenerationResponse(payload, {
            taskId: `task-title-cover-typography-${index}`,
            imageUrls: ["/assets/title-cover-typography/content"],
            assetIds: ["title-cover-typography"]
          })
        )
    });

    await activateTitleCoverWorkflow();
    await fillTitleCoverDraft("Typography title", "Typography copy");
    await clickTitleCoverGenerateButton();
    expect(generationPostCalls(fetchMock)).toHaveLength(1);

    const preset = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-title-cover-typography-preset="true"]'
    );
    const mainColor = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-main-color="true"]'
    );
    const secondaryColor = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-title-cover-secondary-color="true"]'
    );
    expect(preset).toBeTruthy();
    expect(mainColor).toBeTruthy();
    expect(secondaryColor).toBeTruthy();

    await act(async () => {
      if (preset) setControlledFormValue(preset, "bold-yellow");
      if (mainColor) setControlledFormValue(mainColor, "#ff0000");
      if (secondaryColor) setControlledFormValue(secondaryColor, "#00ff00");
      await Promise.resolve();
    });

    expect(preset?.value).toBe("bold-yellow");
    expect(mainColor?.value).toBe("#ff0000");
    expect(secondaryColor?.value).toBe("#00ff00");
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationTaskDetailCalls(fetchMock)).toHaveLength(0);
  });

  it("keeps one Title Cover mobile business tree and moves the result before the editor", async () => {
    const fetchMock = await mountGenerationPage({
      mobile: true,
      assetContentHandler: async () =>
        new Response(new Blob(["visual"], { type: "image/png" }), {
          status: 200,
          headers: { "Content-Type": "image/png" }
        }),
      postHandler: async (index, payload) =>
        generationJsonResponse(
          createGenerationResponse(payload, {
            taskId: `task-title-cover-mobile-order-${index}`,
            imageUrls: ["/assets/title-cover-mobile-order/content"],
            assetIds: ["title-cover-mobile-order"]
          })
        )
    });

    await activateTitleCoverWorkflow();
    await fillTitleCoverDraft("Mobile title", "Mobile copy");
    const formBeforeResult = generationHost?.querySelector<HTMLElement>(
      '[data-image-title-cover-form="true"]'
    );
    expect(formBeforeResult?.className).toContain("order-1");
    expect(
      generationHost?.querySelector('[data-image-title-cover-mobile-advanced-content="true"]')
    ).toBeNull();
    await clickTitleCoverGenerateButton();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    const formAfterResult = generationHost?.querySelector<HTMLElement>(
      '[data-image-title-cover-form="true"]'
    );
    const resultHero = generationHost?.querySelector<HTMLElement>(
      '[data-image-title-cover-result-hero="true"]'
    );
    const resultDetails = generationHost?.querySelector<HTMLElement>(
      '[data-image-workbench-result-success="true"]'
    );
    expect(generationHost?.querySelectorAll('[data-image-title-cover-form="true"]')).toHaveLength(1);
    expect(formAfterResult?.className).toContain("order-2");
    expect(resultHero?.className).toContain("order-1");
    expect(resultDetails?.className).toContain("order-3");
    expect(generationHost?.querySelector('[data-image-title-cover-composed-preview="true"]')).toBeTruthy();
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
  });

  it("loads authenticated backend image history once while models hydrate", async () => {
    const fetchMock = await mountGenerationPage({
      initialToken: "authenticated-token",
      models: [imageModel()]
    });

    await settleGenerationPage();

    expect(backendHistoryCalls(fetchMock)).toHaveLength(1);
  });

  it("does not refetch history when imageModelMap changes after models resolve", async () => {
    const fetchMock = await mountGenerationPage({
      initialToken: "authenticated-token",
      models: [imageModel({ displayName: "Hydrated Image Model" })]
    });

    await settleGenerationPage();
    const historyCountAfterMount = backendHistoryCalls(fetchMock).length;
    expect(historyCountAfterMount).toBe(1);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(backendHistoryCalls(fetchMock)).toHaveLength(historyCountAfterMount);
  });

  it("coalesces focus and visibility refreshes and permits one refresh after debounce", async () => {
    const initialNow = 10_000;
    vi.spyOn(Date, "now").mockReturnValue(initialNow);
    const pendingInitialHistory = createDeferred<Response>();
    let historyAttempt = 0;
    const fetchMock = await mountGenerationPage({
      backendHistoryHandler: async () => {
        historyAttempt += 1;
        return historyAttempt === 1
          ? pendingInitialHistory.promise
          : generationJsonResponse({ tasks: [] });
      }
    });

    expect(backendHistoryCalls(fetchMock)).toHaveLength(1);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(backendHistoryCalls(fetchMock)).toHaveLength(1);

    pendingInitialHistory.resolve(generationJsonResponse({ tasks: [] }));
    await settleGenerationPage();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(backendHistoryCalls(fetchMock)).toHaveLength(1);

    vi.spyOn(Date, "now").mockReturnValue(
      initialNow + backendImageHistoryReloadDebounceMs
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(backendHistoryCalls(fetchMock)).toHaveLength(2);
  });

  it("keeps two refresh events to one in-flight history request", async () => {
    const initialNow = 20_000;
    vi.spyOn(Date, "now").mockReturnValue(initialNow);
    const pendingRefresh = createDeferred<Response>();
    let historyAttempt = 0;
    const fetchMock = await mountGenerationPage({
      backendHistoryHandler: async () => {
        historyAttempt += 1;
        return historyAttempt === 2
          ? pendingRefresh.promise
          : generationJsonResponse({ tasks: [] });
      }
    });

    vi.spyOn(Date, "now").mockReturnValue(
      initialNow + backendImageHistoryReloadDebounceMs
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(backendHistoryCalls(fetchMock)).toHaveLength(2);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(backendHistoryCalls(fetchMock)).toHaveLength(2);

    pendingRefresh.resolve(generationJsonResponse({ tasks: [] }));
    await settleGenerationPage();
  });

  it("aborts pending history on unmount and ignores its completion", async () => {
    const pendingHistory = createDeferred<Response>();
    const fetchMock = await mountGenerationPage({
      backendHistoryHandler: async () => pendingHistory.promise
    });
    const historyCall = backendHistoryCalls(fetchMock)[0];
    const historySignal = (historyCall?.[1] as RequestInit | undefined)?.signal;

    expect(historySignal).toBeInstanceOf(AbortSignal);
    await unmountGenerationRoute();
    expect(historySignal?.aborted).toBe(true);

    pendingHistory.resolve(
      generationJsonResponse({
        tasks: [
          createGenerationResponse(
            { prompt: "stale history", imageSessionId: "stale-session" },
            { taskId: "stale-task" }
          ).task
        ]
      })
    );
    await settleGenerationPage();

    expect(generationHost).toBeNull();
  });
});

describe("image core bootstrap lifecycle", () => {
  it("aborts a pending models bootstrap when the route unmounts", async () => {
    const pendingModels = createDeferred<Response>();
    let modelsSignal: AbortSignal | undefined;
    const fetchMock = await mountGenerationPage({
      modelsHandler: async (_url, init) => {
        modelsSignal = init?.signal ?? undefined;
        return pendingModels.promise;
      }
    });

    expect(modelsSignal).toBeInstanceOf(AbortSignal);
    expect(backendHistoryCalls(fetchMock)).toHaveLength(1);

    await unmountGenerationRoute();

    expect(modelsSignal?.aborted).toBe(true);
    pendingModels.resolve(
      generationJsonResponse({ models: [imageModel({ displayName: "Late model" })] })
    );
    await settleGenerationPage();
  });

  it("aborts a pending page-local quota bootstrap when the route unmounts", async () => {
    const pendingQuota = createDeferred<Response>();
    let quotaSignal: AbortSignal | undefined;
    await mountGenerationPage({
      quotaHandler: async (_url, init) => {
        quotaSignal = init?.signal ?? undefined;
        return pendingQuota.promise;
      }
    });

    expect(quotaSignal).toBeInstanceOf(AbortSignal);

    await unmountGenerationRoute();

    expect(quotaSignal?.aborted).toBe(true);
    pendingQuota.resolve(generationJsonResponse({ remainingCredits: 7 }));
    await settleGenerationPage();
  });

  it("ignores a late models completion after route unmount without an error write", async () => {
    const pendingModels = createDeferred<Response>();
    const fetchMock = await mountGenerationPage({
      modelsHandler: async () => pendingModels.promise
    });
    const mountedHost = generationHost;

    await act(async () => generationRoot?.unmount());
    generationRoot = null;

    pendingModels.resolve(
      generationJsonResponse({ models: [imageModel({ displayName: "Stale model" })] })
    );
    await settleGenerationPage();

    expect(fetchMock).toHaveBeenCalled();
    expect(mountedHost?.querySelector('[data-image-error-toast="true"]')).toBeNull();
    expect(mountedHost?.textContent ?? "").toBe("");
  });

  it("aborts account A models and fences its late completion from account B", async () => {
    const pendingModelsA = createDeferred<Response>();
    const modelSignals: AbortSignal[] = [];
    let modelRequestCount = 0;
    const fetchMock = await mountGenerationPage({
      workspaceAuth: true,
      modelsHandler: async (_url, init) => {
        modelSignals.push(init?.signal as AbortSignal);
        modelRequestCount += 1;
        if (modelRequestCount === 1) {
          return pendingModelsA.promise;
        }
        return generationJsonResponse({
          models: [imageModel({ slug: "account-b-model", displayName: "Account B model" })]
        });
      }
    });

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-workspace-auth-switch="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(modelSignals[0]?.aborted).toBe(true);
    expect(modelRequestCount).toBe(2);
    expect(generationHost?.textContent).toContain("Account B model");
    expect(generationHost?.querySelector('[data-image-error-toast="true"]')).toBeNull();

    pendingModelsA.resolve(
      generationJsonResponse({
        models: [imageModel({ slug: "account-a-model", displayName: "Account A stale model" })]
      })
    );
    await settleGenerationPage();

    expect(generationHost?.textContent).toContain("Account B model");
    expect(generationHost?.textContent).not.toContain("Account A stale model");
    expect(generationHost?.querySelector('[data-image-error-toast="true"]')).toBeNull();
    expect(backendHistoryCalls(fetchMock)).toHaveLength(2);
  });

  it("aborts Image A bootstrap across a Chat route and keeps Image B current", async () => {
    const pendingModelsA = createDeferred<Response>();
    let signalA: AbortSignal | undefined;
    await mountGenerationPage({
      modelsHandler: async (_url, init) => {
        signalA = init?.signal ?? undefined;
        return pendingModelsA.promise;
      }
    });

    await unmountGenerationRoute();
    expect(signalA?.aborted).toBe(true);

    let signalB: AbortSignal | undefined;
    const fetchB = await mountGenerationPage({
      modelsHandler: async (_url, init) => {
        signalB = init?.signal ?? undefined;
        return generationJsonResponse({
          models: [imageModel({ slug: "image-b-model", displayName: "Image B model" })]
        });
      }
    });

    expect(signalB?.aborted).toBe(false);
    expect(
      fetchB.mock.calls.filter(([input]) => {
        const url = generationUrl(input);
        return url.pathname.endsWith("/models") && url.searchParams.get("surface") === "image";
      })
    ).toHaveLength(1);
    expect(generationHost?.textContent).toContain("Image B model");

    pendingModelsA.resolve(
      generationJsonResponse({
        models: [imageModel({ slug: "image-a-model", displayName: "Image A stale model" })]
      })
    );
    await settleGenerationPage();

    expect(generationHost?.textContent).toContain("Image B model");
    expect(generationHost?.textContent).not.toContain("Image A stale model");
  });

  it("keeps a normal authenticated Image core bootstrap to one models and one page-local quota request", async () => {
    const fetchMock = await mountGenerationPage({
      initialToken: "authenticated-token"
    });

    expect(
      fetchMock.mock.calls.filter(([input]) => {
        const url = generationUrl(input);
        return url.pathname.endsWith("/models") && url.searchParams.get("surface") === "image";
      })
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([input]) => generationUrl(input).pathname.endsWith("/quota/me"))
    ).toHaveLength(1);
  });

  it("keeps normal core bootstrap request counts and avoids a stale history start on account transition", async () => {
    const historyAuthorizationHeaders: string[] = [];
    const fetchMock = await mountGenerationPage({
      workspaceAuth: true,
      backendHistoryHandler: async (_url, init) => {
        historyAuthorizationHeaders.push(
          new Headers(init?.headers).get("Authorization") ?? ""
        );
        return generationJsonResponse({ tasks: [] });
      }
    });

    await settleGenerationPage();
    expect(
      fetchMock.mock.calls.filter(([input]) => {
        const url = generationUrl(input);
        return url.pathname.endsWith("/models") && url.searchParams.get("surface") === "image";
      })
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([input]) => generationUrl(input).pathname.endsWith("/quota/me"))
    ).toHaveLength(2);
    expect(historyAuthorizationHeaders).toEqual(["Bearer token-a"]);

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-workspace-auth-switch="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    await settleGenerationPage();

    expect(historyAuthorizationHeaders).toEqual(["Bearer token-a", "Bearer token-b"]);
  });

});

describe("image creation handoff", () => {
  const now = 1_000_000;

  afterEach(() => {
    clearImageCreationHandoff();
  });

  it("accepts the exact descriptor and preserves no URL or private data", () => {
    expect(writeImageCreationHandoff("asset-reference", now)).toBe(true);
    expect(window.sessionStorage.getItem(getImageCreationHandoffStorageKey())).toBe(
      JSON.stringify({
        schemaVersion: 1,
        intent: "continue-image-creation",
        assetId: "asset-reference",
        issuedAt: now
      })
    );
    expect(readImageCreationHandoff(now)).toEqual({
      schemaVersion: 1,
      intent: "continue-image-creation",
      assetId: "asset-reference",
      issuedAt: now
    });
    const raw = window.sessionStorage.getItem(getImageCreationHandoffStorageKey()) ?? "";
    expect(raw).not.toContain("url");
    expect(raw).not.toContain("private");
    expect(raw).not.toContain("base64");
    expect(raw).not.toContain("token");
    expect(raw).not.toContain("prompt");
  });

  it.each([
    ["malformed JSON", "{"],
    ["wrong version", JSON.stringify({ schemaVersion: 2, intent: "continue-image-creation", assetId: "asset", issuedAt: now })],
    ["wrong intent", JSON.stringify({ schemaVersion: 1, intent: "other", assetId: "asset", issuedAt: now })],
    ["empty asset id", JSON.stringify({ schemaVersion: 1, intent: "continue-image-creation", assetId: "", issuedAt: now })],
    ["invalid issuedAt", JSON.stringify({ schemaVersion: 1, intent: "continue-image-creation", assetId: "asset", issuedAt: Number.NaN })],
    ["future timestamp", JSON.stringify({ schemaVersion: 1, intent: "continue-image-creation", assetId: "asset", issuedAt: now + imageCreationHandoffTtlMs + 1 })],
    ["expired timestamp", JSON.stringify({ schemaVersion: 1, intent: "continue-image-creation", assetId: "asset", issuedAt: now - imageCreationHandoffTtlMs })]
  ])("fails closed for %s", (_label, raw) => {
    expect(parseImageCreationHandoff(raw, now)).toBeNull();
  });

  it("fails closed when sessionStorage read or write throws", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(writeImageCreationHandoff("asset-reference", now)).toBe(false);
    setItem.mockRestore();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(readImageCreationHandoff(now)).toBeNull();
  });
});

type GenerationFetchMock = ReturnType<typeof vi.fn>;
type ReconcileTaskStatus = "running" | "succeeded" | "failed";
type AssetContentHandler = (url: URL, init: RequestInit | undefined) => Promise<Response>;

let generationHost: HTMLDivElement | null = null;
let generationRoot: Root | null = null;
let restoreObjectUrlMethods: (() => void) | null = null;
let restoreReferenceCompressionMocks: (() => void) | null = null;
let generationScrollTo: ReturnType<typeof vi.fn> | null = null;

function generationJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function generationUrl(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

function readGenerationPayload(body: BodyInit | null | undefined) {
  const parsed: unknown = JSON.parse(String(body ?? "{}"));

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  return parsed;
}

function readPayloadString(payload: object, key: string, fallback: string) {
  if (key in payload) {
    const value = Reflect.get(payload, key);
    if (typeof value === "string") {
      return value;
    }
  }

  return fallback;
}

function createGenerationResponse(
  payload: object,
  options?: {
    taskId?: string;
    imageUrl?: string;
    imageUrls?: string[];
    assetIds?: string[];
    assetMetadata?: Array<Record<string, unknown> | null>;
  }
): ImageGenerationResponse {
  const taskId = options?.taskId ?? "task-generated";
  const imageUrl = options?.imageUrl ?? "https://cdn.example.test/generated.png";
  const imageUrls = options?.imageUrls ?? [imageUrl];
  const prompt = readPayloadString(payload, "prompt", "A quiet reading room");
  const modelId = readPayloadString(payload, "modelId", "image-model");
  const task: AiTaskSummary = {
    id: taskId,
    userId: "user-1",
    type: "image",
    status: "succeeded",
    modelId,
    prompt,
    input: { ...payload },
    output: { images: imageUrls },
    costCredits: 2,
    errorMessage: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:05.000Z",
    completedAt: "2026-07-15T00:00:05.000Z"
  };

  return {
    task,
    assets: imageUrls.map((url, index) => ({
        id: options?.assetIds?.[index] ?? `${taskId}-asset${imageUrls.length > 1 ? `-${index + 1}` : ""}`,
        userId: "user-1",
        taskId,
        type: "image",
        url,
        thumbnailUrl: null,
        title: prompt,
        metadata: options?.assetMetadata?.[index] ?? null,
        createdAt: task.createdAt,
        taskPrompt: prompt
      }))
  };
}

function createVersionEntry(
  status: ImageStreamEntry["status"],
  index: number,
  withAsset = true
): ImageStreamEntry {
  const result = createGenerationResponse(
    { prompt: `Version prompt ${index}`, imageSessionId: "version-session" },
    { taskId: `version-task-${index}`, imageUrl: `https://cdn.example.test/version-${index}.png` }
  );

  return {
    id: `version-entry-${index}`,
    imageSessionId: "version-session",
    prompt: result.task.prompt,
    modelName: "Image Model",
    modelId: "image-model",
    aspectRatio: "auto",
    mode: "text-to-image",
    referenceImage: null,
    status,
    result: withAsset && status === "succeeded" ? result : null,
    error: status === "failed" ? "safe failure" : null
  };
}

describe("image result version derivation", () => {
  it("restores Transcript to Images workflow metadata from task history", () => {
    const response = createGenerationResponse({
      workflow: "transcript-images",
      mode: "text-to-image",
      count: 1,
      prompt: "Transcript scene prompt"
    });
    const entry = taskToImageStreamEntry(
      response.task,
      new Map([["image-model", imageModel()]]),
      createTranslator("en-US"),
      response.assets
    );

    expect(entry.workflow).toBe("transcript-images");
    expect(entry.mode).toBe("text-to-image");
    expect(entry.requestedCount).toBe(1);
  });

  it("only derives succeeded entries with a real complete asset", () => {
    const entries = [
      createVersionEntry("loading", 1),
      createVersionEntry("checking", 2),
      createVersionEntry("failed", 3),
      createVersionEntry("succeeded", 4, false),
      createVersionEntry("succeeded", 5)
    ];

    expect(deriveImageResultVersions(entries).map((version) => version.versionNumber)).toEqual([1]);
    expect(deriveImageResultVersions(entries)[0]?.asset.id).toBe("version-task-5-asset");
  });

  it("keeps stable source numbering while a recent-five view trims older versions", () => {
    const entries = Array.from({ length: 7 }, (_, index) =>
      createVersionEntry("succeeded", index + 1)
    );
    const versions = deriveImageResultVersions(entries);

    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(versions.slice(-5).map((version) => version.versionNumber)).toEqual([3, 4, 5, 6, 7]);
  });

  it("defaults to the newest version and falls back when the selected entry disappears", () => {
    const versions = deriveImageResultVersions([
      createVersionEntry("succeeded", 1),
      createVersionEntry("succeeded", 2)
    ]);

    expect(resolveSelectedImageResultVersion(versions, null)?.versionNumber).toBe(2);
    expect(resolveSelectedImageResultVersion(versions, "version-entry-1")?.versionNumber).toBe(1);
    expect(resolveSelectedImageResultVersion(versions, "missing-entry")?.versionNumber).toBe(2);
    expect(resolveSelectedImageResultVersion([], "missing-entry")).toBeNull();
  });

  it("keeps all assets in one ordered batch with stable result entry ids", () => {
    const response = createGenerationResponse(
      { prompt: "Four ordered outputs", count: 4 },
      {
        taskId: "task-four-output",
        imageUrls: ["https://cdn.example.test/0.png", "https://cdn.example.test/1.png", "https://cdn.example.test/2.png", "https://cdn.example.test/3.png"],
        assetMetadata: [0, 1, 2, 3].map((imageOutputIndex) => ({ imageOutputIndex }))
      }
    );
    const entry = {
      ...createVersionEntry("succeeded", 1),
      requestedCount: 4 as const,
      result: response
    };

    const batches = deriveImageResultBatches([entry]);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.taskId).toBe("task-four-output");
    expect(batches[0]?.assets.map((asset) => asset.displayUrl)).toEqual(
      response.assets.map((asset) => asset.url)
    );
    expect(batches[0]?.assets.map((asset) => asset.imageOutputIndex)).toEqual([
      0,
      1,
      2,
      3
    ]);
    expect(new Set(batches[0]?.assets.map((asset) => asset.resultEntryId)).size).toBe(4);
  });

  it("does not collide result keys when an API response repeats an asset id", () => {
    const response = createGenerationResponse(
      { prompt: "Repeated asset ids", count: 2 },
      {
        taskId: "task-duplicate-assets",
        imageUrls: ["https://cdn.example.test/repeat-a.png", "https://cdn.example.test/repeat-b.png"],
        assetIds: ["asset-same", "asset-same"]
      }
    );
    const entry = {
      ...createVersionEntry("succeeded", 30),
      requestedCount: 2 as const,
      result: response
    };
    const resultEntries = deriveImageResultBatches([entry])[0]?.assets ?? [];

    expect(resultEntries).toHaveLength(2);
    expect(resultEntries.map((resultEntry) => resultEntry.resultEntryId)).toEqual([
      "task-duplicate-assets:asset-same",
      "task-duplicate-assets:asset-same:duplicate-1"
    ]);
  });

  it("marks only non-empty underfilled batches as partial success", () => {
    for (const [requestedCount, actualCount] of [
      [4, 1],
      [4, 3],
      [2, 1]
    ] as const) {
      const response = createGenerationResponse(
        { prompt: `${actualCount} outputs`, count: requestedCount },
        {
          taskId: `task-partial-${requestedCount}-${actualCount}`,
          imageUrls: Array.from(
            { length: actualCount },
            (_, index) => `https://cdn.example.test/partial-${index}.png`
          )
        }
      );
      const entry = {
        ...createVersionEntry("succeeded", requestedCount + actualCount),
        requestedCount,
        result: response
      };

      expect(deriveImageResultBatches([entry])[0]?.partialSuccess).toBe(true);
    }
  });

  it("trims successful history by whole batch and retains the newest five batches", () => {
    const batchEntries = Array.from({ length: 6 }, (_, index) =>
      createVersionEntry("succeeded", index + 1)
    );
    const retained = trimImageStreamEntries(batchEntries);

    expect(retained.map((entry) => entry.id)).toEqual([
      "version-entry-2",
      "version-entry-3",
      "version-entry-4",
      "version-entry-5",
      "version-entry-6"
    ]);

    const multiAssetEntry = {
      ...createVersionEntry("succeeded", 20),
      result: createGenerationResponse(
        { prompt: "One batch", count: 2 },
        {
          taskId: "task-whole-batch",
          imageUrls: ["https://cdn.example.test/batch-1.png", "https://cdn.example.test/batch-2.png"]
        }
      ),
      requestedCount: 2 as const
    };
    const withWholeBatch = trimImageStreamEntries([
      ...batchEntries.slice(1),
      multiAssetEntry
    ]);

    expect(withWholeBatch.some((entry) => entry.id === multiAssetEntry.id)).toBe(true);
    expect(
      withWholeBatch.find((entry) => entry.id === multiAssetEntry.id)?.result?.assets
    ).toHaveLength(2);
  });

  it("retains the newest five successful batches independently for each workflow", () => {
    const entries = [
      ...Array.from({ length: 6 }, (_, index) => ({
        ...createVersionEntry("succeeded", index + 1),
        id: `free-entry-${index + 1}`,
        workflow: "free-create" as const
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        ...createVersionEntry("succeeded", index + 1),
        id: `title-entry-${index + 1}`,
        workflow: "title-cover" as const
      }))
    ];

    const retained = trimImageStreamEntries(entries);

    expect(
      retained
        .filter((entry) => (entry.workflow ?? "free-create") === "free-create")
        .map((entry) => entry.id)
    ).toEqual(["free-entry-2", "free-entry-3", "free-entry-4", "free-entry-5", "free-entry-6"]);
    expect(
      retained
        .filter((entry) => entry.workflow === "title-cover")
        .map((entry) => entry.id)
    ).toEqual(["title-entry-2", "title-entry-3", "title-entry-4", "title-entry-5", "title-entry-6"]);
  });

  it("keeps legacy Free Create retention and sanitizes reference bytes across workflows", () => {
    const legacyEntries = Array.from({ length: 6 }, (_, index) =>
      createVersionEntry("succeeded", index + 1)
    );
    expect(trimImageStreamEntries(legacyEntries).map((entry) => entry.id)).toEqual([
      "version-entry-2",
      "version-entry-3",
      "version-entry-4",
      "version-entry-5",
      "version-entry-6"
    ]);

    const sessions = [
      {
        id: "workflow-retention-session",
        title: "Workflow retention",
        entries: [
          ...Array.from({ length: 5 }, (_, index) => ({
            ...createVersionEntry("succeeded", index + 1),
            id: `free-storage-entry-${index + 1}`,
            workflow: "free-create" as const,
            referenceImage: {
              dataUrl: `data:image/png;base64,free-${index + 1}`,
              mimeType: "image/png",
              name: `free-${index + 1}.png`
            }
          })),
          ...Array.from({ length: 5 }, (_, index) => ({
            ...createVersionEntry("succeeded", index + 1),
            id: `title-storage-entry-${index + 1}`,
            workflow: "title-cover" as const,
            referenceImage: {
              dataUrl: `data:image/png;base64,title-${index + 1}`,
              mimeType: "image/png",
              name: `title-${index + 1}.png`
            }
          }))
        ]
      }
    ];
    const serialized = serializeImageSessionsForStorage(
      sessions,
      "workflow-retention-session"
    );
    const parsed = parseStoredImageSessions(serialized);
    const parsedEntries = parsed?.sessions[0]?.entries ?? [];

    expect(serialized).not.toContain("data:image/png;base64,free-");
    expect(serialized).not.toContain("data:image/png;base64,title-");
    expect(parsedEntries.filter((entry) => entry.workflow === "title-cover")).toHaveLength(5);
    expect(
      parsedEntries.filter((entry) => (entry.workflow ?? "free-create") === "free-create")
    ).toHaveLength(5);
    expect(parsedEntries.every((entry) => entry.referenceImage === null)).toBe(true);
  });
});

function createReconcileTask(
  status: ReconcileTaskStatus,
  payload: object,
  index: number,
  imageUrl?: string
): AiTaskSummary {
  const response = createGenerationResponse(payload, {
    taskId: `task-reconciled-${index}`,
    imageUrl: imageUrl ?? `https://cdn.example.test/reconciled-${index}.png`
  });

  return {
    ...response.task,
    status,
    output: status === "succeeded" ? response.task.output : null,
    errorMessage: status === "failed" ? "Safe reconciled failure" : null,
    completedAt:
      status === "succeeded" || status === "failed"
        ? "2026-07-15T00:00:05.000Z"
        : null
  };
}

function generationPostCalls(fetchMock: GenerationFetchMock) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const url = generationUrl(input);
    return init?.method === "POST" && url.pathname.endsWith("/image/generate");
  });
}

function generationReconcileCalls(fetchMock: GenerationFetchMock) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const url = generationUrl(input);
    return (
      (init?.method ?? "GET") === "GET" &&
      url.pathname.endsWith("/tasks") &&
      url.searchParams.get("type") === "image" &&
      url.searchParams.get("limit") === "20"
    );
  });
}

function backendHistoryCalls(fetchMock: GenerationFetchMock) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const url = generationUrl(input);
    return (
      (init?.method ?? "GET") === "GET" &&
      url.pathname.endsWith("/tasks") &&
      url.searchParams.get("type") === "image" &&
      url.searchParams.get("limit") === "100"
    );
  });
}

function generationTaskDetailCalls(fetchMock: GenerationFetchMock) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const url = generationUrl(input);
    return (
      (init?.method ?? "GET") === "GET" &&
      url.pathname.startsWith("/api/tasks/")
    );
  });
}

function generationAssetContentCalls(fetchMock: GenerationFetchMock) {
  return fetchMock.mock.calls.filter(([input]) => {
    const url = generationUrl(input);
    return url.pathname.startsWith("/api/assets/") && url.pathname.endsWith("/content");
  });
}

function generationRequestHeaders(call: unknown[]): Headers {
  const init = call[1];

  if (!init || typeof init !== "object" || !("headers" in init)) {
    return new Headers();
  }

  return new Headers(init.headers as HeadersInit);
}

function generationRequestBody(call: unknown[]): string {
  const init = call[1];

  if (!init || typeof init !== "object" || !("body" in init)) {
    return "";
  }

  return String(init.body ?? "");
}

async function settleGenerationPage() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function settleImageScrollRestoreFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => resolve());
      } else {
        window.setTimeout(resolve, 0);
      }
    });
  });
}

function createDeferred<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => {
    throw new Error("Deferred promise resolver was not initialized");
  };
  let rejectPromise: (reason?: unknown) => void = () => {
    throw new Error("Deferred promise rejecter was not initialized");
  };
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve(value: T) {
      resolvePromise(value);
    },
    reject(reason?: unknown) {
      rejectPromise(reason);
    }
  };
}

async function mountGenerationPage(options?: {
  initialPrompt?: string;
  initialResult?: ImageGenerationResponse | null;
  initialToken?: string | null;
  initialReferenceImage?: React.ComponentProps<typeof ImagePageContent>["initialReferenceImage"];
  models?: AiModelSummary[];
  modelQuery?: string;
  mobile?: boolean;
  locale?: Locale;
  reconcileStatuses?: Array<ReconcileTaskStatus | undefined>;
  reconcileImageUrl?: string;
  backendHistoryTasks?: AiTaskSummary[];
  initialSessionId?: string | null;
  historyDetail?: boolean;
  mode?: string;
  modelsHandler?: AssetContentHandler;
  assetContentHandler?: AssetContentHandler;
  handoffAsset?: AiAssetSummary;
  handoffTask?: AiTaskSummary | null;
  handoffOwnerHandler?: (url: URL, init: RequestInit | undefined) => Promise<Response>;
  backendHistoryHandler?: (url: URL, init: RequestInit | undefined) => Promise<Response>;
  quotaHandler?: (url: URL, init: RequestInit | undefined) => Promise<Response>;
  rawHandoff?: string;
  workspaceAuth?: boolean;
  workspaceAuthStoredUser?: AuthUser | null;
  preserveStorage?: boolean;
  publicSettings?: PublicSiteSettings;
  postHandler?: (
    index: number,
    payload: object,
    init: RequestInit | undefined
  ) => Promise<Response>;
}) {
  const reconcileStatuses = options?.reconcileStatuses ?? [];
  const locale = options?.locale ?? "en-US";
  const models = options?.models ?? [imageModel()];
  let postIndex = 0;
  let reconcileIndex = 0;
  let latestReconcileDetail: ImageGenerationResponse | null = null;
  let latestPayload: object = {};
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = generationUrl(input);

      if (init?.method === "POST" && url.pathname.endsWith("/image/generate")) {
        latestPayload = readGenerationPayload(init.body);
        const currentPostIndex = postIndex;
        postIndex += 1;
        return options?.postHandler
          ? options.postHandler(currentPostIndex, latestPayload, init)
          : generationJsonResponse(
              createGenerationResponse(latestPayload, {
                taskId: `task-generated-${currentPostIndex}`
              })
            );
      }

      if (url.pathname.endsWith("/models")) {
        if (options?.modelsHandler) {
          return options.modelsHandler(url, init);
        }
        return generationJsonResponse({ models });
      }

      if (url.pathname.endsWith("/quota/me")) {
        if (options?.quotaHandler) {
          return options.quotaHandler(url, init);
        }
        return generationJsonResponse({ remainingCredits: 20 });
      }

      if (url.pathname.endsWith("/settings/public")) {
        return generationJsonResponse({ settings: options?.publicSettings ?? {} });
      }

      if (
        url.pathname.endsWith("/tasks") &&
        url.searchParams.get("limit") === "100"
      ) {
        if (options?.backendHistoryHandler) {
          return options.backendHistoryHandler(url, init);
        }
        return generationJsonResponse({ tasks: options?.backendHistoryTasks ?? [] });
      }

      if (
        url.pathname.endsWith("/tasks") &&
        url.searchParams.get("limit") === "20"
      ) {
        const status = reconcileStatuses[reconcileIndex];
        reconcileIndex += 1;
        const response = createGenerationResponse(latestPayload, {
          taskId: `task-reconciled-${reconcileIndex}`,
          imageUrl: options?.reconcileImageUrl ?? `https://cdn.example.test/reconciled-${reconcileIndex}.png`
        });
        const task = {
          ...response.task,
          status: status ?? "running",
          output: status === "succeeded" ? response.task.output : null,
          errorMessage: status === "failed" ? "Safe reconciled failure" : null,
          completedAt:
            status === "succeeded" || status === "failed"
              ? "2026-07-15T00:00:05.000Z"
              : null
        } satisfies AiTaskSummary;
        latestReconcileDetail = { task, assets: response.assets };
        return generationJsonResponse({
          tasks: status
            ? [task]
            : []
        });
      }

      if (url.pathname.startsWith("/api/tasks/") && latestReconcileDetail) {
        return generationJsonResponse(latestReconcileDetail);
      }

      if (url.pathname.startsWith("/api/assets/") && !url.pathname.endsWith("/content")) {
        if (options?.handoffOwnerHandler) {
          return options.handoffOwnerHandler(url, init);
        }
        if (!options?.handoffAsset) {
          throw new Error(`Unexpected asset detail request: ${url.pathname}`);
        }

        return generationJsonResponse({
          asset: options.handoffAsset,
          task: options.handoffTask ?? null
        });
      }

      if (url.pathname.startsWith("/api/assets/") && url.pathname.endsWith("/content")) {
        if (!options?.assetContentHandler) {
          throw new Error(`Unexpected asset content request: ${url.pathname}`);
        }

        return options.assetContentHandler(url, init);
      }

      throw new Error(`Unexpected test request: ${url.pathname}${url.search}`);
    }
  );

  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: options?.mobile ?? false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
  generationScrollTo = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: generationScrollTo
  });
  if (!options?.preserveStorage) {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
  if (options?.workspaceAuth) {
    window.localStorage.setItem(authTokenKey, "token-a");
    const storedUser =
      options.workspaceAuthStoredUser === undefined
        ? workspaceTestUserA
        : options.workspaceAuthStoredUser;
    if (storedUser) {
      window.localStorage.setItem(authUserKey, JSON.stringify(storedUser));
    } else {
      window.localStorage.removeItem(authUserKey);
    }
  }
  if (options?.handoffAsset) {
    expect(writeImageCreationHandoff(options.handoffAsset.id)).toBe(true);
  }
  if (options?.rawHandoff !== undefined) {
    window.sessionStorage.setItem(getImageCreationHandoffStorageKey(), options.rawHandoff);
  }
  const testUrl = new URL(window.location.href);
  testUrl.pathname = "/image";
  const testSearch = new URLSearchParams();
  if (options?.mode) {
    testSearch.set("mode", options.mode);
  }
  if (options?.modelQuery) {
    testSearch.set("model", options.modelQuery);
  }
  testUrl.search = testSearch.toString() ? `?${testSearch.toString()}` : "";
  window.history.replaceState({}, "", testUrl);
  generationHost = document.createElement("div");
  document.body.append(generationHost);
  generationRoot = createRoot(generationHost);

  await act(async () => {
    generationRoot?.render(
      <I18nContext.Provider
        value={{
          locale,
          setLocale: vi.fn(),
          t: createTranslator(locale)
        }}
      >
        {options?.workspaceAuth ? (
          <WorkspaceShellProvider gateUntilHydrated={false}>
            <WorkspaceAuthProbe />
            <ImagePageContent
              initialToken={
                options?.initialToken === undefined
                  ? "stale-server-token"
                  : options.initialToken
              }
              initialCredits={20}
              initialModels={models}
              initialPrompt={options?.initialPrompt ?? "A quiet reading room"}
              initialResult={options?.initialResult ?? null}
              initialReferenceImage={options?.initialReferenceImage}
              initialSessionId={options?.initialSessionId}
              historyDetail={options?.historyDetail}
            />
          </WorkspaceShellProvider>
        ) : (
          <ImagePageContent
            initialToken={
              options?.initialToken === undefined ? "token" : options.initialToken
            }
            initialCredits={20}
            initialModels={models}
            initialPrompt={options?.initialPrompt ?? "A quiet reading room"}
            initialResult={options?.initialResult ?? null}
            initialReferenceImage={options?.initialReferenceImage}
            initialSessionId={options?.initialSessionId}
            historyDetail={options?.historyDetail}
          />
        )}
      </I18nContext.Provider>
    );
  });
  await settleGenerationPage();

  return fetchMock;
}

function generationButton() {
  return generationHost?.querySelector<HTMLButtonElement>(
    '[data-image-generate-button="true"]'
  );
}

function resumeGenerationButton() {
  return generationHost?.querySelector<HTMLButtonElement>(
    '[data-image-resume-request-button="true"]'
  );
}

function retryGenerationAsNewRequestButton() {
  return generationHost?.querySelector<HTMLButtonElement>(
    '[data-image-retry-as-new-request-button="true"]'
  );
}

function reusePromptButton() {
  return generationHost?.querySelector<HTMLButtonElement>(
    '[data-image-workbench-reuse-prompt="true"]'
  );
}

function newDrawingButton() {
  return generationHost?.querySelector<HTMLButtonElement>(
    '[data-image-new-drawing-btn="true"]'
  );
}

async function clickGenerationButton() {
  const button = generationButton();
  expect(button).toBeTruthy();

  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settleGenerationPage();
}

async function activateTitleCoverWorkflow() {
  await act(async () => {
    generationHost
      ?.querySelector<HTMLButtonElement>('[data-image-workflow="title-cover"]')
      ?.click();
    await Promise.resolve();
  });
}

async function activateTranscriptImagesWorkflow() {
  await act(async () => {
    generationHost
      ?.querySelector<HTMLButtonElement>('[data-image-workflow="transcript-images"]')
      ?.click();
    await Promise.resolve();
  });
}

async function clickTranscriptPlanButton() {
  const button = generationHost?.querySelector<HTMLButtonElement>(
    '[data-transcript-plan="true"]'
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
}

async function clickTranscriptGenerateButton() {
  const button = generationHost?.querySelector<HTMLButtonElement>(
    '[data-transcript-generate-selected="true"]'
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settleGenerationPage();
}

async function fillTitleCoverDraft(
  originalTitle = "Title Cover title",
  mainCopy = "Title Cover copy"
) {
  const title = generationHost?.querySelector<HTMLInputElement>(
    '[data-image-title-cover-original-title="true"]'
  );
  const copy = generationHost?.querySelector<HTMLTextAreaElement>(
    '[data-image-title-cover-main-copy="true"]'
  );

  await act(async () => {
    if (title) setControlledFormValue(title, originalTitle);
    if (copy) setControlledFormValue(copy, mainCopy);
    await Promise.resolve();
  });
}

async function clickTitleCoverGenerateButton() {
  const button = generationHost?.querySelector<HTMLButtonElement>(
    '[data-image-title-cover-generate="true"]'
  );
  expect(button).toBeTruthy();

  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settleGenerationPage();
}

async function clickWorkspaceGenerationButton() {
  const button = generationHost?.querySelector<HTMLButtonElement>(
    '[data-image-workbench-generate="true"]'
  );
  expect(button).toBeTruthy();

  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settleGenerationPage();
}

async function clickResumeGenerationButton() {
  const button = resumeGenerationButton();
  expect(button).toBeTruthy();

  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settleGenerationPage();
}

async function clickRetryGenerationAsNewRequestButton() {
  const button = retryGenerationAsNewRequestButton();
  expect(button).toBeTruthy();

  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settleGenerationPage();
}

async function clickReusePromptButton() {
  const button = reusePromptButton();
  expect(button).toBeTruthy();

  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settleGenerationPage();
}

async function finishGenerationRecoveryAsUnresolved() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8 * 2500);
  });
  await settleGenerationPage();
}

async function setGenerationPrompt(value: string) {
  const input = generationHost?.querySelector<HTMLTextAreaElement>(
    '[data-image-composer-prompt="true"], [data-image-workbench-prompt="true"]'
  );
  expect(input).toBeTruthy();

  await act(async () => {
    if (input) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        input,
        value
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

async function setWorkspacePrompt(value: string) {
  const input = generationHost?.querySelector<HTMLTextAreaElement>(
    '[data-image-workbench-prompt="true"]'
  );
  expect(input).toBeTruthy();

  await act(async () => {
    if (input) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        input,
        value
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

async function unmountGenerationRoute() {
  await act(async () => generationRoot?.unmount());
  generationRoot = null;
  generationHost?.remove();
  generationHost = null;
}

function seedPendingScrollRestoreFixture(assetCount = 1) {
  const sessionId = "scroll-restore-session";
  const imageUrls = Array.from(
    { length: assetCount },
    (_, index) => `/assets/asset-scroll-restore-${index + 1}/content`
  );
  const result = createGenerationResponse(
    { prompt: "Private result for delayed scroll restore", imageSessionId: sessionId },
    {
      taskId: "task-scroll-restore",
      assetIds: imageUrls.map((_, index) => `asset-scroll-restore-${index + 1}`),
      imageUrls
    }
  );
  const entry = {
    ...createVersionEntry("succeeded", 90),
    id: "scroll-restore-entry",
    imageSessionId: sessionId,
    result
  };
  const session = {
    id: sessionId,
    title: "Delayed restore",
    entries: [entry]
  };

  window.sessionStorage.setItem(
    getImageSessionsStorageKey("guest"),
    serializeImageSessionsForStorage([session], sessionId)
  );
  writeImageScrollTop("guest", sessionId, 900);
  return sessionId;
}

function seedRenderedResultSlotsScrollRestoreFixture() {
  const sessionId = "rendered-result-slots-scroll-session";
  const previousResult = createGenerationResponse(
    { prompt: "Previous multi-output result", imageSessionId: sessionId },
    {
      taskId: "task-rendered-slots-previous",
      assetIds: [
        "asset-rendered-slots-previous-1",
        "asset-rendered-slots-previous-2"
      ],
      imageUrls: [
        "/assets/asset-rendered-slots-previous-1/content",
        "/assets/asset-rendered-slots-previous-2/content"
      ]
    }
  );
  const currentResult = createGenerationResponse(
    { prompt: "Current selected result", imageSessionId: sessionId },
    {
      taskId: "task-rendered-slots-current",
      assetIds: ["asset-rendered-slots-current-1"],
      imageUrls: ["/assets/asset-rendered-slots-current-1/content"]
    }
  );
  const session = {
    id: sessionId,
    title: "Rendered result slots",
    entries: [
      {
        ...createVersionEntry("succeeded", 91),
        id: "rendered-slots-previous-entry",
        imageSessionId: sessionId,
        result: previousResult
      },
      {
        ...createVersionEntry("succeeded", 92),
        id: "rendered-slots-current-entry",
        imageSessionId: sessionId,
        result: currentResult
      }
    ]
  };

  window.sessionStorage.setItem(
    getImageSessionsStorageKey("guest"),
    serializeImageSessionsForStorage([session], sessionId)
  );
  writeImageScrollTop("guest", sessionId, 900);
  return sessionId;
}

afterEach(async () => {
  await act(async () => generationRoot?.unmount());
  generationHost?.remove();
  generationRoot = null;
  generationHost = null;
  restoreReferenceCompressionMocks?.();
  restoreReferenceCompressionMocks = null;
  restoreObjectUrlMethods?.();
  restoreObjectUrlMethods = null;
  generationScrollTo = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/image");
});

describe("image history session recovery", () => {
  it("reopens a Title-Cover-only history session in the visual-base workflow", async () => {
    const sessionId = "title-cover-history-session";
    const historicalContextId = "title-cover-history-context-a";
    const currentContextId = "title-cover-history-context-b";
    const internalPrompt =
      "Create a visual background candidate. Visual style: minimal modern. Do not render copy.";
    const response = createGenerationResponse(
      { prompt: internalPrompt, imageSessionId: sessionId },
      {
        taskId: "title-cover-history-task",
        imageUrl: "https://cdn.example.test/title-cover-history.png"
      }
    );
    const historySession = {
      id: sessionId,
      title: "新建画图",
      titleCoverCreationId: currentContextId,
      entries: [
        {
          ...createVersionEntry("succeeded", 1),
          id: "title-cover-history-entry",
          workflow: "title-cover" as const,
          workflowContextId: historicalContextId,
          imageSessionId: sessionId,
          imageSessionTitle: "Book cover history",
          prompt: internalPrompt,
          result: response
        }
      ]
    };
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("guest"),
      serializeImageSessionsForStorage([historySession], sessionId)
    );

    const fetchMock = await mountGenerationPage({
      initialToken: null,
      initialSessionId: sessionId,
      historyDetail: true,
      initialPrompt: "",
      mode: "workspace",
      preserveStorage: true
    });

    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-workflow="title-cover"]'
      )?.getAttribute("aria-selected")
    ).toBe("true");
    expect(
      generationHost?.querySelector('[data-image-workbench-result-success="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-title-cover-result-description="true"]')
    ).toBeTruthy();
    expect(generationHost?.textContent).not.toContain("Create a visual background candidate");
    expect(generationHost?.textContent).not.toContain("Do not render copy");
    expect(
      generationHost?.querySelector<HTMLInputElement>(
        '[data-image-title-cover-original-title="true"]'
      )?.value
    ).toBe("");
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-title-cover-main-copy="true"]'
      )?.value
    ).toBe("");
    expect(generationPostCalls(fetchMock)).toHaveLength(0);

    await unmountGenerationRoute();
    const normalFetchMock = await mountGenerationPage({
      initialToken: null,
      initialPrompt: "",
      mode: "workspace",
      preserveStorage: true
    });
    await activateTitleCoverWorkflow();

    expect(
      generationHost?.querySelector('[data-image-title-cover-result-empty="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-workbench-result-success="true"]')
    ).toBeNull();
    expect(generationPostCalls(normalFetchMock)).toHaveLength(0);
  });

  it("clears a reference-only empty creation through New Creation without POST", async () => {
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "",
      initialReferenceImage: {
        dataUrl: "data:image/jpeg;base64,reference-only",
        mimeType: "image/jpeg",
        name: "reference-only.jpg",
        originalBytes: 120,
        compressedBytes: 90
      }
    });

    expect(
      generationHost?.querySelector('[data-reference-image-preview="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('[data-image-desktop-new-drawing="true"]')
    ).toBeTruthy();

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-desktop-new-drawing="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(
      generationHost?.querySelector('[data-reference-image-preview="true"]')
    ).toBeNull();
    expect(generationHost?.textContent).not.toContain("reference-only.jpg");
    expect(
      generationHost?.querySelector('[data-image-reference-preparation-state="IDLE"]')
    ).toBeTruthy();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("uses the Desktop New Creation handler to clear result, prompt, and reference state", async () => {
    const secondModel = imageModel({
      id: "image-model-two",
      slug: "image-model-two",
      modelId: "image-model-two",
      displayName: "Second Image Model",
      sortOrder: 1
    });
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "Replace this creation",
      initialResult: createGenerationResponse({ prompt: "Existing result" }),
      models: [imageModel(), secondModel],
      initialReferenceImage: {
        dataUrl: "data:image/jpeg;base64,existing-reference",
        mimeType: "image/jpeg",
        name: "existing-reference.jpg",
        originalBytes: 120,
        compressedBytes: 90
      }
    });

    const modelSelect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-model="true"]'
    );
    const aspectSelect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-size="true"]'
    );
    const selectedCount = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-generation-count-option][data-image-generation-count-selected="true"]'
    );
    expect(modelSelect?.value).toBe("image-model");
    expect(aspectSelect?.value).toBe("auto");
    expect(selectedCount?.getAttribute("data-image-generation-count-option")).toBe("1");

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        modelSelect,
        "image-model-two"
      );
      modelSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        aspectSelect,
        "1:1"
      );
      aspectSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option="4"]'
      )?.click();
      await Promise.resolve();
    });
    expect(modelSelect?.value).toBe("image-model-two");
    expect(aspectSelect?.value).toBe("1:1");
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option][data-image-generation-count-selected="true"]'
      )?.getAttribute("data-image-generation-count-option")
    ).toBe("4");

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-desktop-new-drawing="true"]'
      )?.click();
      await Promise.resolve();
    });
    const confirmButton = Array.from(
      generationHost?.querySelectorAll<HTMLButtonElement>('[role="dialog"] button') ?? []
    ).find((button) => button.textContent === "Confirm");
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(
      generationHost?.querySelector('[data-image-result-empty="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>('[data-image-workbench-prompt="true"]')?.value
    ).toBe("");
    expect(
      generationHost?.querySelector('[data-reference-image-preview="true"]')
    ).toBeNull();
    expect(modelSelect?.value).toBe("image-model-two");
    expect(aspectSelect?.value).toBe("auto");
    expect(
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-image-generation-count-option][data-image-generation-count-selected="true"]'
      )?.getAttribute("data-image-generation-count-option")
    ).toBe("4");
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("reuses the reconstructed task prompt from a restored history result without POST", async () => {
    const historyResponse = createGenerationResponse(
      { prompt: "Historical submitted prompt", imageSessionId: "history-reuse-session" },
      {
        taskId: "history-reuse-task",
        imageUrl: "https://cdn.example.test/history-reuse.png"
      }
    );
    const historyEntry = taskToImageStreamEntry(
      historyResponse.task,
      new Map([["image-model", imageModel()]]),
      createTranslator("en-US"),
      historyResponse.assets
    );
    historyEntry.prompt = "   ";
    const historySession = {
      id: "history-reuse-session",
      title: "Restored history",
      entries: [historyEntry]
    };
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("guest"),
      serializeImageSessionsForStorage(
        [historySession],
        historySession.id
      )
    );

    const fetchMock = await mountGenerationPage({
      initialToken: null,
      initialSessionId: historySession.id,
      historyDetail: true,
      initialPrompt: "",
      mode: "workspace",
      preserveStorage: true
    });

    expect(generationHost?.querySelector('[data-image-workbench-result-success="true"]')).toBeTruthy();
    expect(reusePromptButton()?.textContent).toContain("Reuse prompt");
    await clickReusePromptButton();

    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("Historical submitted prompt");
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("loads selected-session history through the existing task contract without POST or task creation", async () => {
    const historyTask = createGenerationResponse({
      prompt: "Restore this historical prompt",
      modelId: "image-model",
      imageSessionId: "history-session",
      imageSessionTitle: "Saved historical session"
    }, { taskId: "history-task", imageUrl: "data:image/png;base64,history" }).task;
    historyTask.createdAt = "2026-07-20T00:00:00.000Z";
    historyTask.updatedAt = "2026-07-20T00:00:05.000Z";
    historyTask.completedAt = "2026-07-20T00:00:05.000Z";

    const fetchMock = await mountGenerationPage({
      initialSessionId: "history-session",
      historyDetail: true,
      initialPrompt: "",
      backendHistoryTasks: [historyTask]
    });

    expect(generationHost?.querySelector('[data-image-creator-history="true"]')).toBeTruthy();
    expect(generationHost?.textContent).not.toContain("Restore this historical prompt");
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
    expect(
      fetchMock.mock.calls.some(([input]) => generationUrl(input).pathname.endsWith("/tasks"))
    ).toBe(true);
  });

  it("starts a new local session from restored history without invoking the Provider", async () => {
    const historyTask = createGenerationResponse({
      prompt: "Existing session",
      imageSessionId: "history-session"
    }, { taskId: "history-task" }).task;

    const fetchMock = await mountGenerationPage({
      initialSessionId: "history-session",
      historyDetail: true,
      initialPrompt: "",
      backendHistoryTasks: [historyTask]
    });
    const button = newDrawingButton();

    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(generationPostCalls(fetchMock)).toHaveLength(0);
    expect(generationHost?.querySelector('[data-image-empty-state="true"]')).toBeTruthy();
  });
});

describe("image submitted-entry scroll policy", () => {
  it("restores an unsubmitted guest prompt after an Image route remount", async () => {
    await mountGenerationPage({ initialToken: null, initialPrompt: "" });
    await setGenerationPrompt("Guest route draft");
    expect(readImagePromptDraft("guest")).toBe("Guest route draft");

    await unmountGenerationRoute();
    await mountGenerationPage({
      initialToken: null,
      initialPrompt: "",
      preserveStorage: true
    });

    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-composer-prompt="true"], [data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("Guest route draft");
  });

  it("restores a user draft only for its authenticated account", async () => {
    await mountGenerationPage({
      workspaceAuth: true,
      initialPrompt: ""
    });
    await setGenerationPrompt("Account A route draft");
    expect(readImagePromptDraft("user:workspace-user-a")).toBe(
      "Account A route draft"
    );

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-workspace-auth-switch="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-composer-prompt="true"], [data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("");
    expect(readImagePromptDraft("user:workspace-user-b")).toBe("");

    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>(
        '[data-workspace-auth-login-a="true"]'
      )?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-composer-prompt="true"], [data-image-workbench-prompt="true"]'
      )?.value
    ).toBe("Account A route draft");
  });

  it("restores Image scroll by account and session, then clamps to the current viewport", async () => {
    await mountGenerationPage({ initialToken: null, initialPrompt: "" });
    const firstContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    expect(firstContainer).toBeTruthy();
    if (!firstContainer) {
      return;
    }
    Object.defineProperties(firstContainer, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 280 }
    });
    await act(async () => {
      firstContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const scrollKeys = Array.from(
      { length: window.sessionStorage.length },
      (_, index) => window.sessionStorage.key(index) ?? ""
    ).filter((key) => key.startsWith(imageScrollStorageKey));
    expect(scrollKeys).toHaveLength(0);

    await unmountGenerationRoute();
    const persistedScrollKeys = Array.from(
      { length: window.sessionStorage.length },
      (_, index) => window.sessionStorage.key(index) ?? ""
    ).filter((key) => key.startsWith(imageScrollStorageKey));
    expect(persistedScrollKeys).toHaveLength(1);
    const savedScrollKey = persistedScrollKeys[0];
    expect(savedScrollKey).toContain("surface-image");
    expect(window.sessionStorage.getItem(savedScrollKey ?? "")).toBe("280");

    await mountGenerationPage({
      initialToken: null,
      initialPrompt: "",
      preserveStorage: true
    });
    const secondContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    expect(secondContainer).toBeTruthy();
    if (!secondContainer) {
      return;
    }
    Object.defineProperties(secondContainer, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 400 }
    });
    await settleImageScrollRestoreFrame();
    const contentSignal = document.createElement("img");
    Object.defineProperty(contentSignal, "complete", {
      configurable: true,
      value: true
    });
    secondContainer.append(contentSignal);
    await act(async () => {
      contentSignal.dispatchEvent(new Event("load", { bubbles: true }));
    });
    expect(generationScrollTo).toHaveBeenCalledWith({
      top: 200,
      behavior: "auto"
    });

    await unmountGenerationRoute();
    expect(window.sessionStorage.getItem(savedScrollKey ?? "")).toBe("200");
  });

  it("deterministically clamps an unreachable route scroll when no async result content is pending", async () => {
    const sessionId = "no-async-scroll-session";
    window.sessionStorage.setItem(
      getImageSessionsStorageKey("guest"),
      serializeImageSessionsForStorage(
        [{ id: sessionId, title: "No async scroll", entries: [] }],
        sessionId
      )
    );
    writeImageScrollTop("guest", sessionId, 900);
    await mountGenerationPage({
      initialToken: null,
      initialPrompt: "",
      initialSessionId: sessionId,
      preserveStorage: true
    });

    const scrollContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    expect(scrollContainer).toBeTruthy();
    if (!scrollContainer) {
      return;
    }
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 850 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 }
    });

    await settleImageScrollRestoreFrame();
    expect(generationScrollTo).toHaveBeenCalledWith({
      top: 450,
      behavior: "auto"
    });

    await unmountGenerationRoute();
    expect(readImageScrollTop("guest", sessionId)).toBe(450);
  });

  it("waits only for rendered result slots before clamping an unreachable route scroll", async () => {
    const sessionId = seedRenderedResultSlotsScrollRestoreFixture();
    const previousRepresentativeContent = createDeferred<Response>();
    const currentContent = createDeferred<Response>();
    mockObjectUrlMethods([
      "blob:rendered-slots-current-hero",
      "blob:rendered-slots-previous-version",
      "blob:rendered-slots-current-version"
    ]);
    const fetchMock = await mountGenerationPage({
      initialToken: "token",
      initialPrompt: "",
      initialSessionId: sessionId,
      preserveStorage: true,
      assetContentHandler: async (url) =>
        url.pathname.includes("asset-rendered-slots-previous-1")
          ? previousRepresentativeContent.promise
          : currentContent.promise
    });

    const scrollContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    expect(scrollContainer).toBeTruthy();
    if (!scrollContainer) {
      return;
    }
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 850 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 }
    });
    await settleImageScrollRestoreFrame();

    expect(
      generationAssetContentCalls(fetchMock).map(([input]) =>
        generationUrl(input).pathname
      )
    ).not.toContain("/api/assets/asset-rendered-slots-previous-2/content");
    expect(generationScrollTo).not.toHaveBeenCalledWith({
      top: 450,
      behavior: "auto"
    });

    await act(async () => {
      previousRepresentativeContent.resolve(privateImageResponse());
      currentContent.resolve(privateImageResponse());
      await Promise.resolve();
      await Promise.resolve();
    });
    await settleGenerationPage();
    const renderedSlotImages = Array.from(
      scrollContainer.querySelectorAll<HTMLImageElement>(
        '[data-image-workbench-result-image="true"] img, [data-image-workbench-result-entry] img, [data-image-workbench-version] img, [data-image-result-card] img'
      )
    );
    expect(renderedSlotImages).toHaveLength(3);
    renderedSlotImages.forEach((image) => {
      Object.defineProperty(image, "complete", {
        configurable: true,
        value: true
      });
    });
    await act(async () => {
      renderedSlotImages[0]?.dispatchEvent(new Event("load", { bubbles: true }));
    });

    expect(generationScrollTo).toHaveBeenCalledWith({
      top: 450,
      behavior: "auto"
    });
    await unmountGenerationRoute();
    expect(readImageScrollTop("guest", sessionId)).toBe(450);
  });

  it("flushes scroll ownership across Image session changes and restores the original session", async () => {
    const sessionA = {
      id: "creator-session-a",
      title: "Creator A",
      entries: [
        {
          id: "creator-entry-a",
          prompt: "Session A prompt",
          modelName: "Image Model",
          modelId: "image-model",
          aspectRatio: "1:1" as const,
          mode: "text-to-image" as const,
          referenceImage: null,
          status: "succeeded" as const,
          result: null,
          error: null
        }
      ]
    };

    window.sessionStorage.setItem(
      getImageSessionsStorageKey("guest"),
      serializeImageSessionsForStorage([sessionA], sessionA.id)
    );
    await mountGenerationPage({
      initialToken: null,
      initialPrompt: "",
      preserveStorage: true
    });

    const scrollContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    expect(scrollContainer).toBeTruthy();
    if (!scrollContainer) {
      return;
    }
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 180 }
    });
    await act(async () => {
      scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(readImageScrollTop("guest", sessionA.id)).toBeNull();

    const newDrawing = newDrawingButton();
    expect(newDrawing).toBeTruthy();
    await act(async () => {
      newDrawing?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    const storedAfterNewSession = parseStoredImageSessions(
      window.sessionStorage.getItem(getImageSessionsStorageKey("guest"))
    );
    const sessionBId = storedAfterNewSession?.activeSessionId;
    expect(sessionBId).toBeTruthy();
    expect(sessionBId).not.toBe(sessionA.id);
    expect(readImageScrollTop("guest", sessionA.id)).toBe(180);
    expect(readImageScrollTop("guest", sessionBId)).toBeNull();

    await unmountGenerationRoute();
    generationScrollTo?.mockClear();
    await mountGenerationPage({
      initialToken: null,
      initialPrompt: "",
      initialSessionId: sessionA.id,
      preserveStorage: true
    });
    const restoredContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    expect(restoredContainer).toBeTruthy();
    if (!restoredContainer) {
      return;
    }
    Object.defineProperties(restoredContainer, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 }
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });
    expect(generationScrollTo).toHaveBeenCalledWith({
      top: 180,
      behavior: "auto"
    });

    await unmountGenerationRoute();
    expect(readImageScrollTop("guest", sessionA.id)).toBe(180);
    expect(readImageScrollTop("guest", sessionBId)).toBeNull();
  });

  it("keeps the original route target pending until delayed image content makes it reachable", async () => {
    const sessionId = seedPendingScrollRestoreFixture();
    mockObjectUrlMethods(["blob:scroll-restore"]);
    await mountGenerationPage({
      initialToken: "token",
      initialPrompt: "",
      initialSessionId: sessionId,
      preserveStorage: true,
      assetContentHandler: async () => privateImageResponse()
    });

    const scrollContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    expect(scrollContainer).toBeTruthy();
    if (!scrollContainer) {
      return;
    }
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 850 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 }
    });
    await settleImageScrollRestoreFrame();

    expect(readImageScrollTop("guest", sessionId)).toBe(900);
    expect(generationScrollTo).not.toHaveBeenCalledWith({
      top: 450,
      behavior: "auto"
    });

    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 1400
    });
    await act(async () => {
      scrollContainer.dispatchEvent(new Event("load", { bubbles: true }));
    });
    expect(generationScrollTo).toHaveBeenCalledWith({
      top: 900,
      behavior: "auto"
    });

    await unmountGenerationRoute();
    expect(readImageScrollTop("guest", sessionId)).toBe(900);
  });

  it("keeps route restoration pending until the selected hero slot resolves after batch thumbnails", async () => {
    const sessionId = seedPendingScrollRestoreFixture(2);
    const heroContent = createDeferred<Response>();
    const firstThumbnailContent = createDeferred<Response>();
    const secondThumbnailContent = createDeferred<Response>();
    const contentRequests = [
      heroContent,
      firstThumbnailContent,
      secondThumbnailContent
    ];
    let contentRequestIndex = 0;
    mockObjectUrlMethods([
      "blob:scroll-private-hero",
      "blob:scroll-private-thumbnail-a",
      "blob:scroll-private-thumbnail-b"
    ]);
    const fetchMock = await mountGenerationPage({
      initialToken: "token",
      initialPrompt: "",
      initialSessionId: sessionId,
      preserveStorage: true,
      assetContentHandler: async () => {
        const request = contentRequests[contentRequestIndex];
        contentRequestIndex += 1;
        if (!request) {
          throw new Error("Unexpected private result slot request");
        }
        return request.promise;
      }
    });

    const scrollContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    expect(scrollContainer).toBeTruthy();
    if (!scrollContainer) {
      return;
    }
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 850 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 }
    });
    await settleImageScrollRestoreFrame();

    const resultImages = () =>
      Array.from(
        scrollContainer.querySelectorAll<HTMLImageElement>(
          '[data-image-workbench-result-image-content="true"], [data-image-workbench-result-entry] img, [data-image-workbench-version] img'
        )
      );
    expect(generationAssetContentCalls(fetchMock)).toHaveLength(3);
    expect(readImageScrollTop("guest", sessionId)).toBe(900);
    expect(resultImages()).toHaveLength(0);
    expect(generationScrollTo).not.toHaveBeenCalledWith({
      top: 450,
      behavior: "auto"
    });

    await act(async () => {
      firstThumbnailContent.resolve(privateImageResponse());
      secondThumbnailContent.resolve(privateImageResponse());
      await Promise.resolve();
      await Promise.resolve();
    });
    await settleGenerationPage();
    const thumbnailImages = Array.from(
      scrollContainer.querySelectorAll<HTMLImageElement>(
        '[data-image-workbench-result-entry] img'
      )
    );
    expect(thumbnailImages).toHaveLength(2);
    expect(
      scrollContainer.querySelector('[data-image-workbench-result-image-content="true"]')
    ).toBeNull();
    thumbnailImages.forEach((image) => {
      Object.defineProperty(image, "complete", {
        configurable: true,
        value: true
      });
    });
    await act(async () => {
      thumbnailImages[0]?.dispatchEvent(new Event("load", { bubbles: true }));
    });

    expect(readImageScrollTop("guest", sessionId)).toBe(900);
    expect(generationScrollTo).not.toHaveBeenCalledWith({
      top: 450,
      behavior: "auto"
    });

    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 1400
    });
    await act(async () => {
      heroContent.resolve(privateImageResponse());
      await Promise.resolve();
      await Promise.resolve();
    });
    await settleGenerationPage();
    const allImages = resultImages();
    expect(allImages).toHaveLength(3);
    allImages.forEach((image) => {
      Object.defineProperty(image, "complete", {
        configurable: true,
        value: true
      });
    });
    await act(async () => {
      allImages[allImages.length - 1]?.dispatchEvent(
        new Event("load", { bubbles: true })
      );
    });

    expect(generationScrollTo).toHaveBeenCalledWith({
      top: 900,
      behavior: "auto"
    });
    await unmountGenerationRoute();
    expect(readImageScrollTop("guest", sessionId)).toBe(900);
  });

  it("cancels pending route restore when the user takes over scrolling", async () => {
    const sessionId = seedPendingScrollRestoreFixture();
    mockObjectUrlMethods(["blob:scroll-user"]);
    await mountGenerationPage({
      initialToken: "token",
      initialPrompt: "",
      initialSessionId: sessionId,
      preserveStorage: true,
      assetContentHandler: async () => privateImageResponse()
    });

    const scrollContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    expect(scrollContainer).toBeTruthy();
    if (!scrollContainer) {
      return;
    }
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 850 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 300 }
    });
    await settleImageScrollRestoreFrame();
    await act(async () => {
      scrollContainer.dispatchEvent(new Event("wheel", { bubbles: true }));
    });
    expect(readImageScrollTop("guest", sessionId)).toBe(900);

    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 1400
    });
    await act(async () => {
      scrollContainer.dispatchEvent(new Event("load", { bubbles: true }));
    });
    expect(generationScrollTo).not.toHaveBeenCalledWith({
      top: 900,
      behavior: "auto"
    });

    await unmountGenerationRoute();
    expect(readImageScrollTop("guest", sessionId)).toBe(300);
  });

  it("keeps pending route restore for textarea editing and button Space activation", async () => {
    const sessionId = seedPendingScrollRestoreFixture();
    const contentRead = createDeferred<Response>();
    mockObjectUrlMethods(["blob:scroll-keyboard"]);
    await mountGenerationPage({
      initialToken: "token",
      initialPrompt: "Prompt input should remain editable",
      initialSessionId: sessionId,
      preserveStorage: true,
      assetContentHandler: async () => contentRead.promise
    });

    const scrollContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    const promptInput = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-composer-prompt="true"]'
    );
    const resultButton = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-workbench-result-image="true"]'
    );
    expect(scrollContainer).toBeTruthy();
    expect(promptInput).toBeTruthy();
    expect(resultButton).toBeTruthy();
    if (!scrollContainer || !promptInput || !resultButton) {
      return;
    }
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 850 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 300 }
    });
    await settleImageScrollRestoreFrame();

    await act(async () => {
      promptInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      );
    });
    await act(async () => {
      resultButton.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true })
      );
    });
    expect(readImageScrollTop("guest", sessionId)).toBe(900);

    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 1400
    });
    await act(async () => {
      contentRead.resolve(privateImageResponse());
      await Promise.resolve();
      await Promise.resolve();
    });
    await settleGenerationPage();
    const resultImages = Array.from(
      scrollContainer.querySelectorAll<HTMLImageElement>(
        '[data-image-workbench-result-image-content="true"], [data-image-workbench-result-entry] img, [data-image-workbench-version] img'
      )
    );
    resultImages.forEach((image) => {
      Object.defineProperty(image, "complete", {
        configurable: true,
        value: true
      });
    });
    await act(async () => {
      resultImages[0]?.dispatchEvent(new Event("load", { bubbles: true }));
    });

    expect(generationScrollTo).toHaveBeenCalledWith({
      top: 900,
      behavior: "auto"
    });
  });

  it("cancels pending route restore for PageDown from focused buttons", async () => {
    const sessionId = seedPendingScrollRestoreFixture();
    const contentRead = createDeferred<Response>();
    mockObjectUrlMethods(["blob:scroll-keyboard-button"]);
    await mountGenerationPage({
      initialToken: "token",
      initialPrompt: "Keyboard route takeover",
      initialSessionId: sessionId,
      preserveStorage: true,
      assetContentHandler: async () => contentRead.promise
    });

    const scrollContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    const resultButton = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-workbench-result-image="true"]'
    );
    expect(scrollContainer).toBeTruthy();
    expect(resultButton).toBeTruthy();
    if (!scrollContainer || !resultButton) {
      return;
    }
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 850 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 300 }
    });
    await settleImageScrollRestoreFrame();

    await act(async () => {
      resultButton.dispatchEvent(
        new KeyboardEvent("keydown", { key: "PageDown", bubbles: true })
      );
    });

    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 1400
    });
    await act(async () => {
      contentRead.resolve(privateImageResponse());
      await Promise.resolve();
      await Promise.resolve();
    });
    await settleGenerationPage();
    const resultImages = Array.from(
      scrollContainer.querySelectorAll<HTMLImageElement>(
        '[data-image-workbench-result-image-content="true"], [data-image-workbench-result-entry] img, [data-image-workbench-version] img'
      )
    );
    resultImages.forEach((image) => {
      Object.defineProperty(image, "complete", {
        configurable: true,
        value: true
      });
    });
    await act(async () => {
      resultImages[0]?.dispatchEvent(new Event("load", { bubbles: true }));
    });

    expect(generationScrollTo).not.toHaveBeenCalledWith({
      top: 900,
      behavior: "auto"
    });

    await unmountGenerationRoute();
    expect(readImageScrollTop("guest", sessionId)).toBe(300);
  });

  it("cancels pending route restore for ArrowDown from native buttons", async () => {
    const sessionId = seedPendingScrollRestoreFixture();
    const contentRead = createDeferred<Response>();
    mockObjectUrlMethods(["blob:scroll-keyboard-arrow-button"]);
    await mountGenerationPage({
      initialToken: "token",
      initialPrompt: "Keyboard button scroll takeover",
      initialSessionId: sessionId,
      preserveStorage: true,
      assetContentHandler: async () => contentRead.promise
    });

    const scrollContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    const resultButton = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-workbench-result-image="true"]'
    );
    expect(scrollContainer).toBeTruthy();
    expect(resultButton).toBeTruthy();
    if (!scrollContainer || !resultButton) {
      return;
    }
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 850 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 300 }
    });
    await settleImageScrollRestoreFrame();

    await act(async () => {
      resultButton.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      );
    });

    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 1400
    });
    await act(async () => {
      contentRead.resolve(privateImageResponse());
      await Promise.resolve();
      await Promise.resolve();
    });
    await settleGenerationPage();
    const resultImages = Array.from(
      scrollContainer.querySelectorAll<HTMLImageElement>(
        '[data-image-workbench-result-image-content="true"], [data-image-workbench-result-entry] img, [data-image-workbench-version] img'
      )
    );
    resultImages.forEach((image) => {
      Object.defineProperty(image, "complete", {
        configurable: true,
        value: true
      });
    });
    await act(async () => {
      resultImages[0]?.dispatchEvent(new Event("load", { bubbles: true }));
    });

    expect(generationScrollTo).not.toHaveBeenCalledWith({
      top: 900,
      behavior: "auto"
    });
    await unmountGenerationRoute();
    expect(readImageScrollTop("guest", sessionId)).toBe(300);
  });

  it("cancels pending route restore for ArrowDown from the unconsumed Creator workflow tab", async () => {
    const sessionId = seedPendingScrollRestoreFixture();
    const contentRead = createDeferred<Response>();
    mockObjectUrlMethods(["blob:scroll-keyboard-workflow-tab"]);
    await mountGenerationPage({
      initialToken: "token",
      initialPrompt: "Workflow tab scroll takeover",
      initialSessionId: sessionId,
      preserveStorage: true,
      assetContentHandler: async () => contentRead.promise
    });

    const scrollContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    const workflowTab = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-workflow="free-create"][role="tab"]'
    );
    expect(scrollContainer).toBeTruthy();
    expect(workflowTab).toBeTruthy();
    if (!scrollContainer || !workflowTab) {
      return;
    }
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 850 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 300 }
    });
    await settleImageScrollRestoreFrame();

    await act(async () => {
      workflowTab.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      );
    });

    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 1400
    });
    await act(async () => {
      contentRead.resolve(privateImageResponse());
      await Promise.resolve();
      await Promise.resolve();
    });
    await settleGenerationPage();
    const resultImages = Array.from(
      scrollContainer.querySelectorAll<HTMLImageElement>(
        '[data-image-workbench-result-image-content="true"], [data-image-workbench-result-entry] img, [data-image-workbench-version] img'
      )
    );
    resultImages.forEach((image) => {
      Object.defineProperty(image, "complete", {
        configurable: true,
        value: true
      });
    });
    await act(async () => {
      resultImages[0]?.dispatchEvent(new Event("load", { bubbles: true }));
    });

    expect(generationScrollTo).not.toHaveBeenCalledWith({
      top: 900,
      behavior: "auto"
    });
    await unmountGenerationRoute();
    expect(readImageScrollTop("guest", sessionId)).toBe(300);
  });

  it("cancels pending route restore for Space from native download links", async () => {
    const sessionId = seedPendingScrollRestoreFixture();
    const contentRead = createDeferred<Response>();
    mockObjectUrlMethods(["blob:scroll-keyboard-link"]);
    await mountGenerationPage({
      initialToken: "token",
      initialPrompt: "Keyboard link scroll takeover",
      initialSessionId: sessionId,
      preserveStorage: true,
      assetContentHandler: async () => contentRead.promise
    });

    const scrollContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    const downloadLink = generationHost?.querySelector<HTMLAnchorElement>(
      '[data-image-workbench-download="true"]'
    );
    expect(scrollContainer).toBeTruthy();
    expect(downloadLink).toBeTruthy();
    if (!scrollContainer || !downloadLink) {
      return;
    }
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 850 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 300 }
    });
    await settleImageScrollRestoreFrame();

    await act(async () => {
      downloadLink.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true })
      );
    });

    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 1400
    });
    await act(async () => {
      contentRead.resolve(privateImageResponse());
      await Promise.resolve();
      await Promise.resolve();
    });
    await settleGenerationPage();
    const resultImages = Array.from(
      scrollContainer.querySelectorAll<HTMLImageElement>(
        '[data-image-workbench-result-image-content="true"], [data-image-workbench-result-entry] img, [data-image-workbench-version] img'
      )
    );
    resultImages.forEach((image) => {
      Object.defineProperty(image, "complete", {
        configurable: true,
        value: true
      });
    });
    await act(async () => {
      resultImages[0]?.dispatchEvent(new Event("load", { bubbles: true }));
    });

    expect(generationScrollTo).not.toHaveBeenCalledWith({
      top: 900,
      behavior: "auto"
    });
    await unmountGenerationRoute();
    expect(readImageScrollTop("guest", sessionId)).toBe(300);
  });

  it("lets a real Generate auto-scroll cancel pending route restoration", async () => {
    const sessionId = seedPendingScrollRestoreFixture();
    mockObjectUrlMethods(["blob:scroll-generate"]);
    await mountGenerationPage({
      initialToken: "token",
      initialPrompt: "Generate after route return",
      initialSessionId: sessionId,
      preserveStorage: true,
      assetContentHandler: async () => privateImageResponse()
    });

    const scrollContainer = generationHost?.querySelector<HTMLElement>(
      '[data-image-main-scroll="true"]'
    );
    expect(scrollContainer).toBeTruthy();
    if (!scrollContainer) {
      return;
    }
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 850 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 }
    });
    await settleImageScrollRestoreFrame();
    generationScrollTo?.mockClear();

    await clickWorkspaceGenerationButton();
    expect(generationScrollTo).toHaveBeenCalledWith({
      top: expect.any(Number),
      behavior: "smooth"
    });

    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 1400
    });
    await act(async () => {
      scrollContainer.dispatchEvent(new Event("load", { bubbles: true }));
    });
    expect(generationScrollTo).not.toHaveBeenCalledWith({
      top: 900,
      behavior: "auto"
    });
  });

  it("does not scroll on initial mount or normal prompt rerenders", async () => {
    await mountGenerationPage({
      initialResult: createGenerationResponse({})
    });

    expect(generationScrollTo).not.toHaveBeenCalled();
    await setGenerationPrompt("A normal rerender must not reposition the page");
    expect(generationScrollTo).not.toHaveBeenCalled();
  });

  it("does not scroll when restoring history or switching creation modes", async () => {
    const historyTask = createGenerationResponse({
      prompt: "Restored task",
      imageSessionId: "history-session"
    }).task;
    await mountGenerationPage({
      mobile: true,
      initialSessionId: "history-session",
      historyDetail: true,
      backendHistoryTasks: [historyTask]
    });

    expect(generationScrollTo).not.toHaveBeenCalled();
    const workbench = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-mobile-mode="workbench"]'
    );
    const quick = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-mobile-mode="quick"]'
    );
    await act(async () => {
      workbench?.click();
      quick?.click();
    });
    expect(generationScrollTo).not.toHaveBeenCalled();
  });

  it("scrolls once after a user submission appends its new image entry", async () => {
    await mountGenerationPage();

    await clickGenerationButton();

    expect(generationScrollTo).toHaveBeenCalledTimes(1);
    expect(generationScrollTo).toHaveBeenCalledWith({
      top: expect.any(Number),
      behavior: "smooth"
    });
  });
});

function privateImageResponse() {
  const response = new Response("private image", {
    headers: { "Content-Type": "image/png" }
  });
  Object.defineProperty(response, "blob", {
    configurable: true,
    value: async () => new window.Blob(["private image"], { type: "image/png" })
  });
  return response;
}

function mockObjectUrlMethods(urls: string[]) {
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const createObjectUrl = vi.fn(() => urls.shift() ?? "blob:unexpected");
  const revokeObjectUrl = vi.fn();

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectUrl
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl
  });
  restoreObjectUrlMethods = () => {
    if (createDescriptor) {
      Object.defineProperty(URL, "createObjectURL", createDescriptor);
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }

    if (revokeDescriptor) {
      Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  };

  return { createObjectUrl, revokeObjectUrl };
}

function mockReferenceCompressionBrowser(
  dimensions: { width: number; height: number } = { width: 800, height: 600 }
) {
  const imageDescriptor = Object.getOwnPropertyDescriptor(window, "Image");
  const fileReaderDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "FileReader"
  );
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalToDataUrl = HTMLCanvasElement.prototype.toDataURL;
  const drawImage = vi.fn();

  class FakeFileReader {
    result: string | ArrayBuffer | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readAsDataURL(_file: Blob) {
      this.result = "data:image/png;base64,dGVzdA==";
      queueMicrotask(() => this.onload?.());
    }
  }

  class FakeImage {
    naturalWidth = dimensions.width;
    naturalHeight = dimensions.height;
    width = dimensions.width;
    height = dimensions.height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }

  Object.defineProperty(window, "Image", {
    configurable: true,
    value: FakeImage
  });
  Object.defineProperty(window, "FileReader", {
    configurable: true,
    value: FakeFileReader
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ drawImage })
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    value: () => referenceCompressionDataUrl
  });

  restoreReferenceCompressionMocks = () => {
    if (imageDescriptor) {
      Object.defineProperty(window, "Image", imageDescriptor);
    } else {
      Reflect.deleteProperty(window, "Image");
    }
    if (fileReaderDescriptor) {
      Object.defineProperty(window, "FileReader", fileReaderDescriptor);
    } else {
      Reflect.deleteProperty(window, "FileReader");
    }
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: originalGetContext
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      configurable: true,
      value: originalToDataUrl
    });
  };

  return { drawImage };
}

function mockDeferredReferenceCompressionBrowser(
  dimensions: { width: number; height: number } = { width: 800, height: 600 }
) {
  const imageDescriptor = Object.getOwnPropertyDescriptor(window, "Image");
  const fileReaderDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "FileReader"
  );
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalToDataUrl = HTMLCanvasElement.prototype.toDataURL;
  const pendingReaders: Array<{
    result: string;
    onload: (() => void) | null;
    onerror: (() => void) | null;
  }> = [];
  const pendingImages: Array<{
    onload: (() => void) | null;
    onerror: (() => void) | null;
  }> = [];

  class DeferredFileReader {
    result = "data:image/png;base64,deferred-source";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readAsDataURL(_file: Blob) {
      pendingReaders.push(this);
    }
  }

  class DeferredImage {
    naturalWidth = dimensions.width;
    naturalHeight = dimensions.height;
    width = dimensions.width;
    height = dimensions.height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      pendingImages.push(this);
    }
  }

  Object.defineProperty(window, "Image", {
    configurable: true,
    value: DeferredImage
  });
  Object.defineProperty(window, "FileReader", {
    configurable: true,
    value: DeferredFileReader
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ drawImage: vi.fn() })
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    value: () => referenceCompressionDataUrl
  });

  restoreReferenceCompressionMocks = () => {
    if (imageDescriptor) {
      Object.defineProperty(window, "Image", imageDescriptor);
    } else {
      Reflect.deleteProperty(window, "Image");
    }
    if (fileReaderDescriptor) {
      Object.defineProperty(window, "FileReader", fileReaderDescriptor);
    } else {
      Reflect.deleteProperty(window, "FileReader");
    }
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: originalGetContext
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      configurable: true,
      value: originalToDataUrl
    });
  };

  return { pendingImages, pendingReaders };
}

describe("private image result rendering", () => {
  it("resolves immediate private results without exposing logical URLs and cleans the preview Blob", async () => {
    const privateUrl = "/assets/asset_private/content";
    const deferredContent = createDeferred<Response>();
    let privateContentRequests = 0;
    const { createObjectUrl, revokeObjectUrl } = mockObjectUrlMethods([
      "blob:immediate-private",
      "blob:preview-private"
    ]);
    const immediateResult = createGenerationResponse({}, { imageUrl: privateUrl });
    const privateAsset = immediateResult.assets[0];

    if (!privateAsset) {
      throw new Error("Expected an immediate private asset fixture");
    }

    const fetchMock = await mountGenerationPage({
      initialResult: {
        ...immediateResult,
        assets: [
          privateAsset,
          {
            ...privateAsset,
            id: "asset_public",
            url: "/generated-assets/public.png"
          },
          {
            ...privateAsset,
            id: "asset_provider",
            url: "https://provider.example.test/provider.png"
          }
        ]
      },
      assetContentHandler: async () => {
        privateContentRequests += 1;
        return privateContentRequests === 1
          ? deferredContent.promise
          : privateImageResponse();
      }
    });

    const firstContentCall = generationAssetContentCalls(fetchMock)[0];
    expect(firstContentCall).toBeDefined();
    expect(generationUrl(firstContentCall?.[0])).toHaveProperty(
      "pathname",
      "/api/assets/asset_private/content"
    );
    expect(generationRequestHeaders(firstContentCall ?? []).get("Authorization")).toBe(
      "Bearer token"
    );
    expect(
      generationHost?.querySelector(`img[src="${privateUrl}"]`)
    ).toBeFalsy();
    expect(generationHost?.innerHTML).not.toContain(privateUrl);
    expect(
      generationHost?.querySelector('img[src="/generated-assets/public.png"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector('img[src="https://provider.example.test/provider.png"]')
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("provider.example.test") || String(input).includes("/generated-assets/public.png")
      )
    ).toBe(false);

    await act(async () => {
      deferredContent.resolve(privateImageResponse());
      await deferredContent.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();

    const resolvedHeroSource = generationHost
      ?.querySelector('[data-image-workbench-result-image-content="true"]')
      ?.getAttribute("src");
    expect(resolvedHeroSource).toMatch(/^blob:/);
    expect(generationHost?.querySelectorAll('[data-image-workbench-result-entry]')).toHaveLength(3);
    expect(
      generationHost?.querySelector('[data-image-workbench-result-entry-selected="true"] img')?.getAttribute("src")
    ).toMatch(/^blob:/);
    expect(createObjectUrl.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(generationHost?.innerHTML).not.toContain("token");

    const privateResultButton = generationHost?.querySelector<HTMLButtonElement>(
      '[data-image-workbench-result-image="true"]'
    );
    expect(privateResultButton).toBeTruthy();
    await act(async () => {
      privateResultButton?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    const previewImage = generationHost?.querySelector<HTMLImageElement>(
      '[data-image-preview-image="true"]'
    );
    expect(previewImage?.getAttribute("src")).toBe(resolvedHeroSource);
    expect(generationAssetContentCalls(fetchMock)).toHaveLength(2);
    expect(
      generationAssetContentCalls(fetchMock).map(([input]) => generationUrl(input).pathname)
    ).toEqual([
      "/api/assets/asset_private/content",
      "/api/assets/asset_private/content"
    ]);

    const previewModal = generationHost?.querySelector<HTMLElement>(
      '[data-image-preview-dialog="true"]'
    );
    expect(previewModal).toBeTruthy();
    await act(async () => {
      previewModal?.click();
      await Promise.resolve();
    });
    expect(revokeObjectUrl).not.toHaveBeenCalled();
  });

  it("uses the same private resolution path for polled results", async () => {
    const privateUrl = "/assets/polled_private/content";
    mockObjectUrlMethods(["blob:polled-private"]);
    const fetchMock = await mountGenerationPage({
      reconcileStatuses: ["succeeded"],
      reconcileImageUrl: privateUrl,
      assetContentHandler: async () => privateImageResponse(),
      postHandler: async () =>
        generationJsonResponse(
          { status: "in_progress", taskId: "task-polled-private", retryAfterMs: 2500 },
          202
        )
    });

    await clickGenerationButton();
    await settleGenerationPage();

    expect(generationReconcileCalls(fetchMock)).toHaveLength(1);
    expect(generationAssetContentCalls(fetchMock)).toHaveLength(1);
    expect(
      generationHost?.querySelector('[data-image-workbench-result-image-content="true"]')?.getAttribute("src")
    ).toBe("blob:polled-private");
    expect(
      generationHost?.querySelector(`img[src="${privateUrl}"]`)
    ).toBeFalsy();
  });

  it("resolves private task.output history images while retaining their logical URL outside img", async () => {
    const privateUrl = "/assets/history_private/content";
    mockObjectUrlMethods(["blob:history-private"]);
    const historyTask: AiTaskSummary = {
      id: "task-history-private",
      userId: "user-1",
      type: "image",
      status: "succeeded",
      modelId: "image-model",
      prompt: "Historical private image",
      input: {
        mode: "text-to-image",
        size: "1024x1024",
        count: 1,
        imageSessionId: "session-history-private",
        imageSessionTitle: "Private history"
      },
      output: { images: [privateUrl] },
      costCredits: 2,
      errorMessage: null,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:01.000Z",
      completedAt: "2020-01-01T00:00:01.000Z"
    };
    const fetchMock = await mountGenerationPage({
      backendHistoryTasks: [historyTask],
      assetContentHandler: async () => privateImageResponse()
    });
    await settleGenerationPage();
    await settleGenerationPage();
    await settleGenerationPage();
    await settleGenerationPage();

    expect(generationHost?.querySelector('[data-image-creator-history="true"]')).toBeTruthy();
    expect(generationAssetContentCalls(fetchMock)).toHaveLength(0);
    expect(generationHost?.innerHTML).not.toContain(privateUrl);
  });

  it("does not fetch or render a private logical URL when the image page has no token", async () => {
    const privateUrl = "/assets/no_token_private/content";
    const initialResult = createGenerationResponse({}, { imageUrl: privateUrl });
    const fetchMock = await mountGenerationPage({
      initialToken: null,
      initialResult,
      assetContentHandler: async () => privateImageResponse()
    });

    expect(generationAssetContentCalls(fetchMock)).toHaveLength(0);
    expect(
      generationHost?.querySelector(`img[src="${privateUrl}"]`)
    ).toBeFalsy();
    expect(generationHost?.innerHTML).not.toContain(privateUrl);
  });
});

describe("image generation attempt request integration", () => {
  it("only treats a succeeded task as immediate failed-fetch reconciliation", () => {
    const requestStartedAt = new Date("2026-07-15T00:00:00.000Z");
    const payload = {
      prompt: "Immediate reconcile classification",
      modelId: "image-model",
      clientEntryId: "failed-reconcile-entry",
      imageSessionId: "failed-reconcile-session"
    };
    const failedTask = createReconcileTask("failed", payload, 1);
    const succeededTask = createReconcileTask("succeeded", payload, 2);
    const options = {
      tasks: [failedTask],
      prompt: failedTask.prompt,
      modelId: "image-model",
      clientEntryId: "failed-reconcile-entry",
      requestStartedAt
    };

    expect(findImageTaskForFailedFetchReconcile(options)).toBeNull();
    expect(
      findImageTaskForFailedFetchReconcile({
        ...options,
        tasks: [succeededTask]
      })?.status
    ).toBe("succeeded");
  });

  it("keeps Auto selected while prompt aspect inference changes only the resolved size", async () => {
    const prompt = "生成一张 16:9 横版封面";
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: prompt
    });
    const desktopEditor = generationHost?.querySelector<HTMLElement>(
      '[data-image-workbench-editor="true"]'
    );
    const aspectSelect = desktopEditor?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-size="true"]'
    );
    const effectiveSize = aspectSelect?.closest("label")?.lastElementChild;

    expect(aspectSelect?.value).toBe("auto");
    expect(effectiveSize?.textContent).toContain("1280x720");

    await clickWorkspaceGenerationButton();

    const payload = JSON.parse(
      generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      prompt,
      modelId: "image-model",
      size: "1280x720",
      count: 1,
      mode: "text-to-image"
    });
    expect(payload).not.toHaveProperty("aspectRatio");
    expect(payload).not.toHaveProperty("inferredAspect");
    expect(payload).not.toHaveProperty("aspectSource");
  });

  it("keeps explicit 1:1 ahead of a conflicting prompt ratio", async () => {
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: "16:9 横版封面"
    });
    const aspectSelect = generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-size="true"]'
    );

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        aspectSelect,
        "1:1"
      );
      aspectSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(aspectSelect?.value).toBe("1:1");
    await clickWorkspaceGenerationButton();

    const payload = JSON.parse(
      generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      size: "1024x1024",
      modelId: "image-model",
      count: 1,
      mode: "text-to-image"
    });
    expect(payload).not.toHaveProperty("aspectRatio");
  });

  it("keeps valid reference dimensions ahead of prompt aspect inference", async () => {
    const prompt = "Create a 16:9 landscape cover";
    mockReferenceCompressionBrowser({ width: 600, height: 900 });
    const fetchMock = await mountGenerationPage({
      mode: "workspace",
      initialPrompt: prompt
    });
    const referenceInput = generationHost?.querySelector<HTMLInputElement>(
      '[data-image-workbench-reference-input="true"]'
    );
    const file = new File(["reference"], "portrait.png", { type: "image/png" });

    Object.defineProperty(referenceInput ?? document.createElement("input"), "files", {
      configurable: true,
      value: [file]
    });
    await act(async () => {
      referenceInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settleGenerationPage();

    expect(
      generationHost?.querySelector('[data-reference-image-preview="true"]')
    ).toBeTruthy();
    expect(
      generationHost?.querySelector(
        '[data-image-workbench-generation-mode="image-to-image"]'
      )
    ).toBeTruthy();
    const desktopEditor = generationHost?.querySelector<HTMLElement>(
      '[data-image-workbench-editor="true"]'
    );
    const aspectSelect = desktopEditor?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-size="true"]'
    );
    const effectiveSize = aspectSelect?.closest("label")?.lastElementChild;
    expect(aspectSelect?.value).toBe("auto");
    expect(effectiveSize?.textContent).toContain("768x1024");

    await clickWorkspaceGenerationButton();

    const payload = JSON.parse(
      generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      prompt,
      modelId: "image-model",
      size: "768x1024",
      count: 1,
      mode: "image-to-image",
      referenceImages: [{
        dataUrl: referenceCompressionDataUrl,
        mimeType: "image/jpeg",
        name: "portrait.png",
        originalBytes: file.size
      }]
    });
    expect(payload).not.toHaveProperty("aspectRatio");
    expect(payload).not.toHaveProperty("referenceImage");
  });

  it("keeps model, ratio, and count controls interactive through the compact request path", async () => {
    const fetchMock = await mountGenerationPage({
      mobile: true,
      locale: "zh-CN",
      models: [
        imageModel(),
        imageModel({
          id: "model_image_two",
          slug: "image-model-two",
          modelId: "image-model-two",
          name: "Second Image Model",
          displayName: "Second Image Model",
          creditCost: 5,
          sortOrder: 1
        })
      ]
    });

    const modelSelect = generationHost?.querySelector<HTMLSelectElement>('[data-image-workbench-model="true"]');
    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>('[data-image-mobile-parameters-toggle="true"]')?.click();
      await Promise.resolve();
    });
    const ratioSelect = generationHost?.querySelector<HTMLSelectElement>('[data-image-workbench-size="true"]');
    expect(modelSelect?.options).toHaveLength(2);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(modelSelect, "image-model-two");
      modelSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(ratioSelect, "16:9");
      ratioSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      generationHost?.querySelector<HTMLButtonElement>('[data-image-generation-count-option="2"]')?.click();
      await Promise.resolve();
    });
    expect(ratioSelect?.value).toBe("16:9");
    expect(generationPostCalls(fetchMock)).toHaveLength(0);

    await clickGenerationButton();
    expect(
      JSON.parse(generationRequestBody(generationPostCalls(fetchMock)[0] ?? []))
    ).toMatchObject({ count: 2, modelId: "image-model-two", size: "1280x720" });
  });

  it("uses native model and aspect controls without Quick selector menus", async () => {
    await mountGenerationPage({ mobile: true });

    expect(generationHost?.querySelector('[data-image-workbench-model="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-workbench-size="true"]')).toBeNull();
    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>('[data-image-mobile-parameters-toggle="true"]')?.click();
      await Promise.resolve();
    });
    expect(generationHost?.querySelector('[data-image-workbench-size="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-quick-model-menu="true"]')).toBeFalsy();
    expect(generationHost?.querySelector('[data-image-quick-ratio-menu="true"]')).toBeFalsy();
  });

  it("sends one ordered referenceImages item without the legacy scalar", async () => {
    const referenceImage = {
      dataUrl: "data:image/jpeg;base64,cm9vbQ==",
      mimeType: "image/jpeg" as const,
      name: "room.jpg",
      originalBytes: 2048,
      compressedBytes: 1024
    };
    const fetchMock = await mountGenerationPage({
      initialReferenceImage: referenceImage
    });

    await clickGenerationButton();

    const payload = JSON.parse(
      generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
    ) as Record<string, unknown>;
    expect(payload.referenceImages).toEqual([referenceImage]);
    expect("referenceImage" in payload).toBe(false);
  });

  it("routes the mobile history button to the independent history page without a drawer", async () => {
    await mountGenerationPage({ mobile: true });

    const historyButton = generationHost?.querySelector<HTMLAnchorElement>(
      '[data-image-mobile-history-button="true"]'
    );
    expect(historyButton).toBeTruthy();
    expect(historyButton?.getAttribute("href")).toBe("/image/history");
    expect(
      generationHost?.querySelector('[data-image-mobile-history-drawer="true"]')
    ).toBeNull();
  });

  it("keeps a legacy mobile URL mode from changing the unified Creator or submitting", async () => {
    const fetchMock = await mountGenerationPage({
      mobile: true,
      initialPrompt: "Prompt survives mode changes",
      mode: "quick"
    });
    expect(window.location.search).toBe("?mode=quick");
    expect(generationHost?.querySelector<HTMLTextAreaElement>('[data-image-workbench-prompt="true"]')?.value).toBe("Prompt survives mode changes");
    expect(generationHost?.querySelector('[data-image-mobile-mode="quick"]')).toBeNull();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
    expect(generationHost?.querySelector('[data-image-creator-workspace="true"]')).toBeTruthy();
  });

  it("keeps the selected model, size, and reference image in the unified Creator", async () => {
    const fetchMock = await mountGenerationPage({
      mobile: true,
      initialPrompt: "Shared creation state",
      initialReferenceImage: {
        dataUrl: "https://cdn.example.com/reference.jpg",
        mimeType: "image/jpeg",
        name: "room.jpg",
        originalBytes: 2048,
        compressedBytes: 1024
      },
      models: [
        imageModel(),
        imageModel({
          id: "model_image_two",
          name: "Image Model Two",
          displayName: "Image Model Two",
          slug: "image-model-two",
          modelId: "image-model-two",
          creditCost: 3,
          sortOrder: 1
        })
      ]
    });

    const modelSelect = generationHost?.querySelector<HTMLSelectElement>('[data-image-workbench-model="true"]');
    await act(async () => {
      generationHost?.querySelector<HTMLButtonElement>('[data-image-mobile-parameters-toggle="true"]')?.click();
      await Promise.resolve();
    });
    const sizeSelect = generationHost?.querySelector<HTMLSelectElement>('[data-image-workbench-size="true"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(modelSelect, "image-model-two");
      modelSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(sizeSelect, "16:9");
      sizeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-model="true"]'
    )?.value).toBe("image-model-two");
    expect(generationHost?.querySelector<HTMLSelectElement>(
      '[data-image-workbench-size="true"]'
    )?.value).toBe("16:9");
    expect(generationHost?.querySelector('[data-image-workbench-reference-remove="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-mobile-mode="workbench"]')).toBeNull();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
  });

  it("reads legacy URL mode changes without changing unified Creator presentation", async () => {
    await mountGenerationPage({ mobile: true, mode: "quick" });

    window.history.pushState({}, "", "/image?mode=quick");
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
      await Promise.resolve();
    });

    expect(generationHost?.querySelector('[data-image-creator-workspace="true"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-creation-mode="quick"]')).toBeTruthy();
  });

  it("clears the prompt after fetch starts while the first request is pending", async () => {
    const deferredResponse = createDeferred<Response>();
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Prompt retained while pending",
      postHandler: async () => deferredResponse.promise
    });

    const button = generationButton();
    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    const promptInput = generationHost?.querySelector<HTMLTextAreaElement>(
      '[data-image-composer-prompt="true"]'
    );
    expect(promptInput?.value).toBe("");
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(generationHost?.querySelector('[data-image-ai-status="loading"]')).toBeTruthy();
    expect(generationPostCalls(fetchMock)).toHaveLength(1);

    await act(async () => {
      deferredResponse.resolve(
        generationJsonResponse(createGenerationResponse(readGenerationPayload(
          generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
        )))
      );
      await deferredResponse.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(promptInput?.value).toBe("");
  });

  it("does not send a second request when the loading button is clicked twice", async () => {
    const deferredResponse = createDeferred<Response>();
    const fetchMock = await mountGenerationPage({
      postHandler: async () => deferredResponse.promise
    });

    const button = generationButton();
    await act(async () => {
      button?.click();
      button?.click();
      await Promise.resolve();
    });

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    await act(async () => {
      deferredResponse.resolve(
        generationJsonResponse(createGenerationResponse(readGenerationPayload(
          generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])
        )))
      );
      await deferredResponse.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();
  });

  it("keeps the new run POST lock when the stopped run resolves later", async () => {
    const responseA = createDeferred<Response>();
    const responseB = createDeferred<Response>();
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Prompt A",
      postHandler: async (index, payload) =>
        index === 0
          ? responseA.promise
          : responseB.promise
    });

    await clickGenerationButton();
    expect(generationPostCalls(fetchMock)).toHaveLength(1);

    await act(async () => {
      newDrawingButton()?.click();
      await Promise.resolve();
    });
    await setGenerationPrompt("Prompt B");
    await clickGenerationButton();
    expect(generationPostCalls(fetchMock)).toHaveLength(2);
    expect(
      readGenerationPayload(
        generationRequestBody(generationPostCalls(fetchMock)[1] ?? [])
      )
    ).toMatchObject({ prompt: "Prompt B" });

    await act(async () => {
      responseA.resolve(
        generationJsonResponse(
          createGenerationResponse(
            readGenerationPayload(generationRequestBody(generationPostCalls(fetchMock)[0] ?? [])),
            { taskId: "task-a-late" }
          )
        )
      );
      await responseA.promise;
      await Promise.resolve();
    });

    expect(generationPostCalls(fetchMock)).toHaveLength(2);
    generationButton()?.click();
    expect(generationPostCalls(fetchMock)).toHaveLength(2);

    await act(async () => {
      responseB.resolve(
        generationJsonResponse(
          createGenerationResponse(
            readGenerationPayload(generationRequestBody(generationPostCalls(fetchMock)[1] ?? [])),
            { taskId: "task-b" }
          )
        )
      );
      await responseB.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(generationPostCalls(fetchMock)).toHaveLength(2);
    expect(generationHost?.querySelector('[data-image-ai-result="true"]')).toBeTruthy();
  });

  it("uses the getRandomValues UUID fallback and clears a successful prompt", async () => {
    try {
      vi.stubGlobal("crypto", {
        getRandomValues(bytes: Uint8Array) {
          bytes.fill(0x5a);
          return bytes;
        }
      });
      const fetchMock = await mountGenerationPage({
        initialPrompt: "Fallback UUID prompt"
      });

      await clickGenerationButton();

      expect(generationPostCalls(fetchMock)).toHaveLength(1);
      expect(generationRequestHeaders(generationPostCalls(fetchMock)[0] ?? []).get(
        "Idempotency-Key"
      )).toMatch(/^[0-9a-f-]{36}$/i);
      expect(
        generationHost?.querySelector<HTMLTextAreaElement>(
          '[data-image-composer-prompt="true"]'
        )?.value
      ).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows the fixed safe error and sends no request when secure UUID APIs are missing", async () => {
    try {
      vi.stubGlobal("crypto", undefined);
      const fetchMock = await mountGenerationPage({
        initialPrompt: "Prompt must remain after pre-fetch failure"
      });

      await clickGenerationButton();

      expect(generationPostCalls(fetchMock)).toHaveLength(0);
      expect(generationHost?.textContent).toContain(
        "当前浏览器暂时无法提交，请刷新或更换浏览器后重试"
      );
      expect(
        generationHost?.querySelector<HTMLTextAreaElement>(
          '[data-image-composer-prompt="true"]'
        )?.value
      ).toBe("Prompt must remain after pre-fetch failure");
      expect(generationButton()?.disabled).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("restores the submitted prompt after a terminal non-2xx response", async () => {
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Restore this prompt",
      postHandler: async () =>
        generationJsonResponse(
          {
            message: "Safe terminal failure",
            code: "IMAGE_GENERATION_FAILED",
            retryable: false
          },
          500
        )
    });

    await clickGenerationButton();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-composer-prompt="true"]'
      )?.value
    ).toBe("Restore this prompt");
  });

  it("does not restore the submitted prompt after failure when the user typed new content", async () => {
    const response = createDeferred<Response>();
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Old submitted prompt",
      postHandler: async () => response.promise
    });

    await clickGenerationButton();
    await setGenerationPrompt("New prompt from the user");

    await act(async () => {
      response.resolve(
        generationJsonResponse(
          {
            message: "Safe terminal failure",
            code: "IMAGE_GENERATION_FAILED",
            retryable: false
          },
          500
        )
      );
      await response.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-composer-prompt="true"]'
      )?.value
    ).toBe("New prompt from the user");
  });

  it("uses form submit as the only generate entry and prevents the default event", () => {
    expect(imagePageSource).toContain("function handleGenerateSubmit");
    expect(imagePageSource).toContain("event.preventDefault();");
    expect(imagePageSource).toContain('type="submit"');
    expect(imagePageSource).not.toContain("onClick={generate}");
    expect(imagePageSource).not.toContain("onTouchStart={generate}");
    expect(imagePageSource).not.toContain("onPointerDown={generate}");
  });

  it("sends one immutable attempt POST and uses a new key on the next explicit success", async () => {
    const fetchMock = await mountGenerationPage();

    await clickGenerationButton();

    let postCalls = generationPostCalls(fetchMock);
    expect(postCalls).toHaveLength(1);
    const firstHeaders = generationRequestHeaders(postCalls[0] ?? []);
    const firstBody = generationRequestBody(postCalls[0] ?? []);
    const firstKey = firstHeaders.get("Idempotency-Key");
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(firstHeaders.get("Authorization")).toBe("Bearer token");
    expect(firstHeaders.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(firstBody)).toMatchObject({
      prompt: "A quiet reading room",
      modelId: "image-model",
      size: "1024x1024",
      count: 1,
      mode: "text-to-image"
    });
    expect(firstBody).not.toContain(firstKey ?? "missing-key");
    expect(generationHost?.querySelector('[data-image-ai-status="succeeded"]')).toBeTruthy();
    expect(retryGenerationAsNewRequestButton()).toBeFalsy();
    expect(
      generationHost?.querySelector(
        'img[src="https://cdn.example.test/generated.png"]'
      )
    ).toBeTruthy();
    expect(generationHost?.textContent).toContain("Current balance: 18");
    expect(generationReconcileCalls(fetchMock)).toHaveLength(0);
    expect(generationHost?.textContent).not.toContain(firstKey ?? "missing-key");

    await setGenerationPrompt("A second explicit generation");
    await clickGenerationButton();

    postCalls = generationPostCalls(fetchMock);
    expect(postCalls).toHaveLength(2);
    const secondHeaders = generationRequestHeaders(postCalls[1] ?? []);
    expect(secondHeaders.get("Idempotency-Key")).not.toBe(firstKey);
    expect(JSON.parse(generationRequestBody(postCalls[1] ?? []))).toMatchObject({
      prompt: "A second explicit generation"
    });
  });

  it("clears a retryable structured failure before the next explicit generation", async () => {
    const fetchMock = await mountGenerationPage({
      postHandler: async (index, payload) =>
        index === 0
          ? generationJsonResponse(
              {
                message: "Safe terminal failure",
                code: "IMAGE_GENERATION_FAILED",
                retryable: true
              },
              500
            )
          : generationJsonResponse(createGenerationResponse(payload))
    });

    await clickGenerationButton();
    expect(generationHost?.querySelector('[data-image-ai-status="failed"]')).toBeTruthy();
    expect(retryGenerationAsNewRequestButton()?.textContent).toContain(
      "Retry as new request"
    );
    expect(generationReconcileCalls(fetchMock)).toHaveLength(0);

    await setGenerationPrompt("Explicit retry after terminal failure");
    await clickGenerationButton();

    const postCalls = generationPostCalls(fetchMock);
    expect(postCalls).toHaveLength(2);
    expect(retryGenerationAsNewRequestButton()).toBeFalsy();
    expect(
      generationRequestHeaders(postCalls[0] ?? []).get("Idempotency-Key")
    ).not.toBe(
      generationRequestHeaders(postCalls[1] ?? []).get("Idempotency-Key")
    );
  });

  it("treats a retryable structured 503 as terminal without task recovery", async () => {
    const fetchMock = await mountGenerationPage({
      locale: "zh-CN",
      initialPrompt: "原始提示词",
      postHandler: async () =>
        generationJsonResponse(
          {
            code: "IMAGE_SAFETY_CHECK_UNAVAILABLE",
            message: "内容安全检查暂时不可用，请稍后再试。",
            retryable: true
          },
          503
        )
    });

    await clickGenerationButton();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationReconcileCalls(fetchMock)).toHaveLength(0);
    expect(generationTaskDetailCalls(fetchMock)).toHaveLength(0);
    expect(generationHost?.querySelector('[data-image-ai-status="failed"]')).toBeTruthy();
    expect(generationHost?.textContent).toContain(
      "内容安全检查暂时不可用，请稍后再试。"
    );
    expect(generationHost?.textContent).not.toContain("正在同步任务结果");
    expect(generationHost?.textContent).not.toContain("任务可能仍在生成");
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-composer-prompt="true"]'
      )?.value
    ).toBe("原始提示词");
    expect(retryGenerationAsNewRequestButton()).toBeTruthy();

    await settleGenerationPage();
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
  });

  it("treats a non-retryable blocked prompt as terminal without a retry snapshot", async () => {
    const fetchMock = await mountGenerationPage({
      locale: "zh-CN",
      initialPrompt: "被拦截提示词",
      postHandler: async () =>
        generationJsonResponse(
          {
            code: "IMAGE_PROMPT_BLOCKED",
            message: "该提示词可能包含不适合生成的内容，请修改后重试。",
            retryable: false
          },
          422
        )
    });

    await clickGenerationButton();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationReconcileCalls(fetchMock)).toHaveLength(0);
    expect(generationTaskDetailCalls(fetchMock)).toHaveLength(0);
    expect(generationHost?.querySelector('[data-image-ai-status="failed"]')).toBeTruthy();
    expect(generationHost?.textContent).toContain(
      "该提示词可能包含不适合生成的内容，请修改后重试。"
    );
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-composer-prompt="true"]'
      )?.value
    ).toBe("被拦截提示词");
    expect(retryGenerationAsNewRequestButton()).toBeFalsy();
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
  });

  it.each([
    [409, "IDEMPOTENCY_KEY_CONFLICT"],
    [410, "IDEMPOTENCY_RESULT_UNAVAILABLE"]
  ])("treats %i as terminal without POST retry or GET polling", async (status, code) => {
    const fetchMock = await mountGenerationPage({
      postHandler: async () =>
        generationJsonResponse({ message: "Safe idempotency error", code }, status)
    });

    await clickGenerationButton();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationReconcileCalls(fetchMock)).toHaveLength(0);
    expect(generationHost?.querySelector('[data-image-ai-status="failed"]')).toBeTruthy();
    expect(generationHost?.textContent).toContain("Safe idempotency error");
    expect(retryGenerationAsNewRequestButton()?.textContent).toContain(
      "Retry as new request"
    );
  });

  it("uses existing GET reconciliation for a 202 response without another POST", async () => {
    const fetchMock = await mountGenerationPage({
      reconcileStatuses: ["succeeded"],
      postHandler: async () =>
        generationJsonResponse(
          { status: "in_progress", taskId: "task-in-progress", retryAfterMs: 2500 },
          202
        )
    });

    await clickGenerationButton();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationReconcileCalls(fetchMock)).toHaveLength(1);
    expect(generationHost?.querySelector('[data-image-ai-status="succeeded"]')).toBeTruthy();
    expect(generationHost?.querySelector('[data-image-ai-result="true"]')).toBeTruthy();
    expect(retryGenerationAsNewRequestButton()).toBeFalsy();
  });

  it("uses existing polling to reach a failed task after a 202 response", async () => {
    vi.useFakeTimers();
    const fetchMock = await mountGenerationPage({
      reconcileStatuses: ["running", "failed"],
      postHandler: async () =>
        generationJsonResponse(
          { status: "in_progress", taskId: "task-in-progress", retryAfterMs: 2500 },
          202
        )
    });

    await clickGenerationButton();
    expect(generationHost?.querySelector('[data-image-ai-status="checking"]')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await settleGenerationPage();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationReconcileCalls(fetchMock)).toHaveLength(2);
    expect(generationHost?.querySelector('[data-image-ai-status="failed"]')).toBeTruthy();
    expect(generationHost?.textContent).toContain("Safe reconciled failure");
    expect(retryGenerationAsNewRequestButton()?.textContent).toContain(
      "Retry as new request"
    );
  });

  it("polls after an immediate failed recovery match and keeps Free Create Retry", async () => {
    vi.useFakeTimers();
    const fetchMock = await mountGenerationPage({
      reconcileStatuses: ["failed", "failed"],
      postHandler: async () =>
        generationJsonResponse(
          { status: "in_progress", taskId: "task-free-immediate-failed", retryAfterMs: 2500 },
          202
        )
    });

    await clickGenerationButton();
    expect(generationReconcileCalls(fetchMock)).toHaveLength(1);
    expect(generationHost?.querySelector('[data-image-ai-status="checking"]')).toBeTruthy();
    expect(retryGenerationAsNewRequestButton()).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await settleGenerationPage();

    expect(generationReconcileCalls(fetchMock)).toHaveLength(2);
    expect(generationHost?.querySelector('[data-image-ai-status="failed"]')).toBeTruthy();
    expect(retryGenerationAsNewRequestButton()?.textContent).toContain(
      "Retry as new request"
    );
  });

  it("keeps Failed to fetch recovery as GET reconciliation without POST retry", async () => {
    const fetchMock = await mountGenerationPage({
      reconcileStatuses: ["succeeded"],
      postHandler: async () => {
        throw new Error("Failed to fetch");
      }
    });

    await clickGenerationButton();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationReconcileCalls(fetchMock)).toHaveLength(1);
    expect(generationHost?.querySelector('[data-image-ai-status="succeeded"]')).toBeTruthy();
  });

  it("reconciles malformed HTTP JSON through existing GET polling without another POST", async () => {
    vi.useFakeTimers();
    const fetchMock = await mountGenerationPage({
      reconcileStatuses: ["running", "succeeded"],
      postHandler: async () =>
        new Response("private malformed response body", {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
    });

    await clickGenerationButton();
    expect(generationHost?.querySelector('[data-image-ai-status="checking"]')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await settleGenerationPage();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationReconcileCalls(fetchMock)).toHaveLength(2);
    expect(generationHost?.querySelector('[data-image-ai-status="succeeded"]')).toBeTruthy();
    expect(generationHost?.textContent).not.toContain("private malformed response body");
  });

  it("keeps unresolved transport reconciliation at the existing eight 2500ms polls", async () => {
    vi.useFakeTimers();
    const fetchMock = await mountGenerationPage({
      postHandler: async () => {
        throw new Error("Failed to fetch");
      }
    });

    await clickGenerationButton();
    expect(generationReconcileCalls(fetchMock)).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2499);
    });
    expect(generationReconcileCalls(fetchMock)).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(generationReconcileCalls(fetchMock)).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7 * 2500);
    });
    await settleGenerationPage();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(generationReconcileCalls(fetchMock)).toHaveLength(9);
    expect(generationHost?.querySelector('[data-image-ai-status="checking"]')).toBeTruthy();
    expect(generationHost?.textContent).toContain("The task may still be running");
    expect(
      generationHost?.querySelector<HTMLTextAreaElement>(
        '[data-image-composer-prompt="true"]'
      )?.value
    ).toBe("A quiet reading room");
  });

  it("keeps the POST body at click-time while the form changes during the request", async () => {
    const deferredResponse = createDeferred<Response>();
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Click-time prompt",
      postHandler: async () => deferredResponse.promise
    });

    const button = generationButton();
    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    await setGenerationPrompt("Changed while request is pending");

    const postCalls = generationPostCalls(fetchMock);
    expect(postCalls).toHaveLength(1);
    expect(JSON.parse(generationRequestBody(postCalls[0] ?? []))).toMatchObject({
      prompt: "Click-time prompt"
    });

    const payload = readGenerationPayload(generationRequestBody(postCalls[0] ?? []));
    await act(async () => {
      deferredResponse.resolve(
        generationJsonResponse(createGenerationResponse(payload))
      );
      await deferredResponse.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
  });

  it.each([
    ["en-US", "Resume request"],
    ["zh-CN", "继续恢复"]
  ] as const)(
    "shows the dedicated retained-attempt action in %s only after GET recovery is unresolved",
    async (locale, expectedLabel) => {
      vi.useFakeTimers();
      const fetchMock = await mountGenerationPage({
        locale,
        postHandler: async () => {
          throw new Error("Failed to fetch");
        }
      });

      expect(resumeGenerationButton()).toBeFalsy();
      await clickGenerationButton();
      expect(resumeGenerationButton()).toBeFalsy();
      expect(generationPostCalls(fetchMock)).toHaveLength(1);

      await finishGenerationRecoveryAsUnresolved();

      expect(resumeGenerationButton()?.textContent).toContain(expectedLabel);
      expect(retryGenerationAsNewRequestButton()).toBeFalsy();
      expect(generationReconcileCalls(fetchMock)).toHaveLength(9);
    }
  );

  it("resumes with the same key and frozen body after the prompt changes without creating a new attempt", async () => {
    vi.useFakeTimers();
    const randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID");
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Frozen first prompt",
      postHandler: async (index, payload) => {
        if (index === 0) {
          throw new Error("Failed to fetch");
        }
        return generationJsonResponse(
          createGenerationResponse(payload, { taskId: "task-resumed-success" })
        );
      }
    });

    await clickGenerationButton();
    await finishGenerationRecoveryAsUnresolved();
    const firstPost = generationPostCalls(fetchMock)[0] ?? [];
    const firstKey = generationRequestHeaders(firstPost).get("Idempotency-Key");
    const firstBody = generationRequestBody(firstPost);
    const uuidCallsBeforeResume = randomUuidSpy.mock.calls.length;

    await setGenerationPrompt("A changed prompt that must not be sent");
    await clickResumeGenerationButton();

    const postCalls = generationPostCalls(fetchMock);
    expect(postCalls).toHaveLength(2);
    expect(generationRequestHeaders(postCalls[1] ?? []).get("Idempotency-Key")).toBe(
      firstKey
    );
    expect(generationRequestBody(postCalls[1] ?? [])).toBe(firstBody);
    expect(JSON.parse(generationRequestBody(postCalls[1] ?? []))).toMatchObject({
      prompt: "Frozen first prompt"
    });
    expect(randomUuidSpy).toHaveBeenCalledTimes(uuidCallsBeforeResume);
    expect(resumeGenerationButton()).toBeFalsy();
    expect(generationHost?.querySelector('[data-image-ai-status="succeeded"]')).toBeTruthy();
    expect(generationHost?.textContent).toContain("Current balance: 18");
    expect(generationHost?.textContent).not.toContain(firstKey ?? "missing-key");
  });

  it("uses the atomic POST lock so a fast resume double click sends only one recovery POST", async () => {
    vi.useFakeTimers();
    const resumedResponse = createDeferred<Response>();
    const fetchMock = await mountGenerationPage({
      postHandler: async (index, payload) => {
        if (index === 0) {
          throw new Error("Failed to fetch");
        }
        return resumedResponse.promise.then(
          () => generationJsonResponse(createGenerationResponse(payload))
        );
      }
    });

    await clickGenerationButton();
    await finishGenerationRecoveryAsUnresolved();
    const button = resumeGenerationButton();
    expect(button).toBeTruthy();

    await act(async () => {
      button?.click();
      button?.click();
      await Promise.resolve();
    });

    expect(generationPostCalls(fetchMock)).toHaveLength(2);
    expect(resumeGenerationButton()).toBeFalsy();

    await act(async () => {
      resumedResponse.resolve(new Response());
      await resumedResponse.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(generationPostCalls(fetchMock)).toHaveLength(2);
  });

  it("does not expose a recovery action while the first POST is still in flight", async () => {
    const firstResponse = createDeferred<Response>();
    const fetchMock = await mountGenerationPage({
      postHandler: async (_index, payload) =>
        firstResponse.promise.then(
          () => generationJsonResponse(createGenerationResponse(payload))
        )
    });

    const button = generationButton();
    await act(async () => {
      button?.click();
      button?.click();
      await Promise.resolve();
    });

    expect(generationPostCalls(fetchMock)).toHaveLength(1);
    expect(resumeGenerationButton()).toBeFalsy();

    await act(async () => {
      firstResponse.resolve(new Response());
      await firstResponse.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
  });

  it.each([
    [500, "IMAGE_GENERATION_FAILED"],
    [409, "IDEMPOTENCY_KEY_CONFLICT"],
    [410, "IDEMPOTENCY_RESULT_UNAVAILABLE"]
  ])(
    "clears the retained attempt and hides recovery after terminal HTTP %i",
    async (status, code) => {
      vi.useFakeTimers();
      const fetchMock = await mountGenerationPage({
        postHandler: async (index) => {
          if (index === 0) {
            throw new Error("Failed to fetch");
          }
          return generationJsonResponse(
            {
              message: "Safe terminal recovery failure",
              code,
              retryable: status === 500
            },
            status
          );
        }
      });

      await clickGenerationButton();
      await finishGenerationRecoveryAsUnresolved();
      await clickResumeGenerationButton();

      expect(generationPostCalls(fetchMock)).toHaveLength(2);
      expect(generationReconcileCalls(fetchMock)).toHaveLength(9);
      expect(resumeGenerationButton()).toBeFalsy();
      expect(retryGenerationAsNewRequestButton()?.textContent).toContain(
        "Retry as new request"
      );
      expect(generationHost?.querySelector('[data-image-ai-status="failed"]')).toBeTruthy();
      expect(generationHost?.textContent).toContain("Safe terminal recovery failure");
    }
  );

  it.each([
    ["202", "in_progress"],
    ["transport", "transport_uncertain"],
    ["unknown", "unknown_http_response"]
  ] as const)(
    "keeps the retained attempt after %s (%s) and shows recovery again only after GET remains unresolved",
    async (responseKind, expectedDecisionKind) => {
      vi.useFakeTimers();
      expect({
        "202": "in_progress",
        transport: "transport_uncertain",
        unknown: "unknown_http_response"
      }[responseKind]).toBe(expectedDecisionKind);
      const fetchMock = await mountGenerationPage({
        postHandler: async (index) => {
          if (index === 0 || expectedDecisionKind === "transport_uncertain") {
            throw new Error("Failed to fetch");
          }
          if (expectedDecisionKind === "in_progress") {
            return generationJsonResponse(
              { status: "in_progress", taskId: "task-retained", retryAfterMs: 2500 },
              202
            );
          }
          return new Response("private malformed response body", {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
      });

      await clickGenerationButton();
      await finishGenerationRecoveryAsUnresolved();
      await clickResumeGenerationButton();

      expect(generationPostCalls(fetchMock)).toHaveLength(2);
      expect(resumeGenerationButton()).toBeFalsy();
      expect(generationReconcileCalls(fetchMock)).toHaveLength(10);

      await finishGenerationRecoveryAsUnresolved();

      expect(generationPostCalls(fetchMock)).toHaveLength(2);
      expect(generationReconcileCalls(fetchMock)).toHaveLength(18);
      expect(resumeGenerationButton()?.textContent).toContain("Resume request");
      expect(retryGenerationAsNewRequestButton()).toBeFalsy();
      expect(generationHost?.textContent).not.toContain("private malformed response body");
    }
  );

  it.each(["succeeded", "failed"] as const)(
    "hides recovery and clears the retained attempt after resumed GET recovery is %s",
    async (terminalStatus) => {
      vi.useFakeTimers();
      const reconcileStatuses: Array<ReconcileTaskStatus | undefined> =
        Array.from({ length: 9 }, () => undefined);
      reconcileStatuses.push(terminalStatus === "succeeded" ? "succeeded" : "running");
      if (terminalStatus === "failed") {
        reconcileStatuses.push("failed");
      }
      const fetchMock = await mountGenerationPage({
        postHandler: async (index) => {
          if (index === 0) {
            throw new Error("Failed to fetch");
          }
          return generationJsonResponse(
            { status: "in_progress", taskId: "task-retained", retryAfterMs: 2500 },
            202
          );
        },
        reconcileStatuses
      });

      await clickGenerationButton();
      await finishGenerationRecoveryAsUnresolved();
      await clickResumeGenerationButton();
      if (terminalStatus === "failed") {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2500);
        });
        await settleGenerationPage();
      }

      expect(generationPostCalls(fetchMock)).toHaveLength(2);
      expect(resumeGenerationButton()).toBeFalsy();
      expect(
        generationHost?.querySelector(`[data-image-ai-status="${terminalStatus}"]`)
      ).toBeTruthy();
      if (terminalStatus === "failed") {
        expect(retryGenerationAsNewRequestButton()?.textContent).toContain(
          "Retry as new request"
        );
      } else {
        expect(retryGenerationAsNewRequestButton()).toBeFalsy();
      }
    }
  );

  it.each([
    ["en-US", "Retry as new request"],
    ["zh-CN", "作为新请求重试"]
  ] as const)(
    "shows the terminal retry-as-new action in %s after a retryable structured failure",
    async (locale, expectedLabel) => {
      const fetchMock = await mountGenerationPage({
        locale,
        postHandler: async () =>
          generationJsonResponse(
            {
              message: "Safe terminal failure",
              code: "IMAGE_GENERATION_FAILED",
              retryable: true
            },
            500
          )
      });

      expect(retryGenerationAsNewRequestButton()).toBeFalsy();
      await clickGenerationButton();

      expect(generationPostCalls(fetchMock)).toHaveLength(1);
      expect(resumeGenerationButton()).toBeFalsy();
      expect(retryGenerationAsNewRequestButton()?.textContent).toContain(
        expectedLabel
      );
    }
  );

  it("retries a terminal failure with one new key and the original frozen body", async () => {
    const randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID");
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Frozen terminal prompt",
      postHandler: async (index, payload) =>
        index === 0
          ? generationJsonResponse(
              {
                message: "Safe terminal failure",
                code: "IMAGE_GENERATION_FAILED",
                retryable: true
              },
              500
            )
          : generationJsonResponse(
              createGenerationResponse(payload, {
                taskId: "task-retry-as-new-success"
              })
            )
    });

    await clickGenerationButton();
    const firstPost = generationPostCalls(fetchMock)[0] ?? [];
    const firstKey = generationRequestHeaders(firstPost).get("Idempotency-Key");
    const firstBody = generationRequestBody(firstPost);
    const uuidCallsBeforeRetry = randomUuidSpy.mock.calls.length;

    await setGenerationPrompt("Changed prompt that retry must ignore");
    await clickRetryGenerationAsNewRequestButton();

    const postCalls = generationPostCalls(fetchMock);
    expect(postCalls).toHaveLength(2);
    expect(generationRequestHeaders(postCalls[1] ?? []).get("Idempotency-Key")).not.toBe(
      firstKey
    );
    expect(generationRequestBody(postCalls[1] ?? [])).toBe(firstBody);
    expect(JSON.parse(generationRequestBody(postCalls[1] ?? []))).toMatchObject({
      prompt: "Frozen terminal prompt"
    });
    expect(randomUuidSpy).toHaveBeenCalledTimes(uuidCallsBeforeRetry + 1);
    expect(retryGenerationAsNewRequestButton()).toBeFalsy();
    expect(resumeGenerationButton()).toBeFalsy();
    expect(generationHost?.querySelector('[data-image-ai-status="succeeded"]')).toBeTruthy();
    expect(generationHost?.textContent).toContain("Current balance: 18");
    expect(generationReconcileCalls(fetchMock)).toHaveLength(0);
    expect(generationHost?.textContent).not.toContain(firstKey ?? "missing-key");
  });

  it("retries with the original ordered referenceImages snapshot after composer changes", async () => {
    mockReferenceCompressionBrowser();
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Original multi reference prompt",
      models: [imageModel({ maxReferenceImages: 4 })],
      postHandler: async (index, payload) =>
        index === 0
          ? generationJsonResponse(
              {
                message: "Safe terminal failure",
                code: "IMAGE_GENERATION_FAILED",
                retryable: true
              },
              500
            )
          : generationJsonResponse(createGenerationResponse(payload))
    });
    const selectFiles = async (files: File[]) => {
      const input = generationHost?.querySelector<HTMLInputElement>(
        '[data-image-workbench-reference-input="true"]'
      );
      Object.defineProperty(input ?? document.createElement("input"), "files", {
        configurable: true,
        value: files
      });
      await act(async () => {
        input?.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      });
      await settleGenerationPage();
    };

    await selectFiles([
      new File(["A"], "A.png", { type: "image/png" }),
      new File(["B"], "B.png", { type: "image/png" })
    ]);
    await clickGenerationButton();
    const firstBody = generationRequestBody(generationPostCalls(fetchMock)[0] ?? []);

    await setGenerationPrompt("Changed composer prompt");
    await selectFiles([
      new File(["C"], "C.png", { type: "image/png" }),
      new File(["D"], "D.png", { type: "image/png" })
    ]);
    await act(async () => {
      generationHost?.querySelectorAll<HTMLElement>('[data-image-reference-item]')[1]
        ?.querySelector<HTMLButtonElement>('[data-image-reference-move-earlier="true"]')
        ?.click();
      await Promise.resolve();
    });

    await clickRetryGenerationAsNewRequestButton();
    const postCalls = generationPostCalls(fetchMock);
    expect(postCalls).toHaveLength(2);
    expect(generationRequestBody(postCalls[1] ?? [])).toBe(firstBody);
    const retryPayload = JSON.parse(generationRequestBody(postCalls[1] ?? [])) as {
      referenceImages: Array<{ name: string }>;
    };
    expect(retryPayload.referenceImages.map((reference) => reference.name)).toEqual([
      "A.png",
      "B.png"
    ]);
  });

  it("uses the shared atomic POST lock for a fast retry-as-new double click", async () => {
    const retryResponse = createDeferred<Response>();
    const randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID");
    const fetchMock = await mountGenerationPage({
      postHandler: async (index, payload) => {
        if (index === 0) {
          return generationJsonResponse(
            {
              message: "Safe terminal failure",
              code: "IMAGE_GENERATION_FAILED",
              retryable: true
            },
            500
          );
        }
        return retryResponse.promise.then(() =>
          generationJsonResponse(createGenerationResponse(payload))
        );
      }
    });

    await clickGenerationButton();
    const button = retryGenerationAsNewRequestButton();
    const uuidCallsBeforeRetry = randomUuidSpy.mock.calls.length;
    expect(button).toBeTruthy();

    await act(async () => {
      button?.click();
      button?.click();
      await Promise.resolve();
    });

    expect(generationPostCalls(fetchMock)).toHaveLength(2);
    expect(randomUuidSpy).toHaveBeenCalledTimes(uuidCallsBeforeRetry + 1);
    expect(retryGenerationAsNewRequestButton()).toBeFalsy();

    await act(async () => {
      retryResponse.resolve(new Response());
      await retryResponse.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();
    expect(generationPostCalls(fetchMock)).toHaveLength(2);
  });

  it("creates a different key for each consecutive terminal retry while preserving the body", async () => {
    const fetchMock = await mountGenerationPage({
      initialPrompt: "Repeat frozen payload",
      postHandler: async (index, payload) =>
        index < 2
          ? generationJsonResponse(
              {
                message: `Safe terminal failure ${index}`,
                code: "IMAGE_GENERATION_FAILED",
                retryable: true
              },
              500
            )
          : generationJsonResponse(createGenerationResponse(payload))
    });

    await clickGenerationButton();
    expect(retryGenerationAsNewRequestButton()).toBeTruthy();
    await setGenerationPrompt("Changed between retries");
    await clickRetryGenerationAsNewRequestButton();
    expect(retryGenerationAsNewRequestButton()).toBeTruthy();
    await clickRetryGenerationAsNewRequestButton();

    const postCalls = generationPostCalls(fetchMock);
    expect(postCalls).toHaveLength(3);
    const keys = postCalls.map((call) =>
      generationRequestHeaders(call).get("Idempotency-Key")
    );
    expect(new Set(keys).size).toBe(3);
    const bodies = postCalls.map((call) => generationRequestBody(call));
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[2] ?? "{}")).toMatchObject({
      prompt: "Repeat frozen payload"
    });
    expect(retryGenerationAsNewRequestButton()).toBeFalsy();
    expect(generationHost?.querySelector('[data-image-ai-status="succeeded"]')).toBeTruthy();
  });

  it.each(["202", "transport", "unknown"] as const)(
    "keeps retry-as-new %s unresolved on GET recovery with only Resume request visible",
    async (responseKind) => {
      vi.useFakeTimers();
      const fetchMock = await mountGenerationPage({
        postHandler: async (index) => {
          if (index === 0) {
            return generationJsonResponse(
              {
                message: "Safe terminal failure",
                code: "IMAGE_GENERATION_FAILED",
                retryable: true
              },
              500
            );
          }
          if (responseKind === "202") {
            return generationJsonResponse(
              { status: "in_progress", taskId: "task-new", retryAfterMs: 2500 },
              202
            );
          }
          if (responseKind === "transport") {
            throw new Error("Failed to fetch");
          }
          return new Response("private malformed response body", {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
      });

      await clickGenerationButton();
      expect(retryGenerationAsNewRequestButton()).toBeTruthy();
      const firstPost = generationPostCalls(fetchMock)[0] ?? [];
      await clickRetryGenerationAsNewRequestButton();
      const secondPost = generationPostCalls(fetchMock)[1] ?? [];

      expect(generationPostCalls(fetchMock)).toHaveLength(2);
      expect(generationRequestHeaders(secondPost).get("Idempotency-Key")).not.toBe(
        generationRequestHeaders(firstPost).get("Idempotency-Key")
      );
      expect(generationRequestBody(secondPost)).toBe(generationRequestBody(firstPost));
      expect(retryGenerationAsNewRequestButton()).toBeFalsy();
      expect(resumeGenerationButton()).toBeFalsy();

      await finishGenerationRecoveryAsUnresolved();

      expect(generationPostCalls(fetchMock)).toHaveLength(2);
      expect(generationReconcileCalls(fetchMock)).toHaveLength(9);
      expect(resumeGenerationButton()?.textContent).toContain("Resume request");
      expect(retryGenerationAsNewRequestButton()).toBeFalsy();
      expect(generationHost?.textContent).not.toContain("private malformed response body");
    }
  );

  it("clears the terminal retry entry when a new main Generate acquires the POST lock", async () => {
    const secondResponse = createDeferred<Response>();
    const fetchMock = await mountGenerationPage({
      postHandler: async (index, payload) =>
        index === 0
          ? generationJsonResponse(
              {
                message: "Safe terminal failure",
                code: "IMAGE_GENERATION_FAILED",
                retryable: true
              },
              500
            )
          : secondResponse.promise.then(() =>
              generationJsonResponse(createGenerationResponse(payload))
            )
    });

    await clickGenerationButton();
    expect(retryGenerationAsNewRequestButton()).toBeTruthy();
    await setGenerationPrompt("A genuinely new request");
    const button = generationButton();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(generationPostCalls(fetchMock)).toHaveLength(2);
    expect(retryGenerationAsNewRequestButton()).toBeFalsy();

    await act(async () => {
      secondResponse.resolve(new Response());
      await secondResponse.promise;
      await Promise.resolve();
    });
    await settleGenerationPage();
  });

  it("clears the terminal retry entry when the user starts a new drawing", async () => {
    const fetchMock = await mountGenerationPage({
      postHandler: async () =>
        generationJsonResponse(
          {
            message: "Safe terminal failure",
            code: "IMAGE_GENERATION_FAILED",
            retryable: true
          },
          500
        )
    });

    await clickGenerationButton();
    expect(retryGenerationAsNewRequestButton()).toBeTruthy();
    const button = newDrawingButton();
    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    const confirmButton = Array.from(
      generationHost?.querySelectorAll<HTMLButtonElement>("button") ?? []
    ).find((candidate) => candidate.textContent === "Confirm");
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });
    await settleGenerationPage();

    expect(retryGenerationAsNewRequestButton()).toBeFalsy();
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
  });

  it("has no retry-as-new DOM action without a terminal snapshot", async () => {
    const fetchMock = await mountGenerationPage();

    expect(retryGenerationAsNewRequestButton()).toBeFalsy();
    expect(generationPostCalls(fetchMock)).toHaveLength(0);
    await clickGenerationButton();
    expect(retryGenerationAsNewRequestButton()).toBeFalsy();
    expect(generationPostCalls(fetchMock)).toHaveLength(1);
  });

  it("keeps the resume handler free of payload building, attempt creation, and automatic invocation", () => {
    const resumeHandlerSource = imagePageSource
      .split("async function resumeImageGenerationRequest()", 2)[1]
      ?.split("async function generate()", 1)[0];

    expect(resumeHandlerSource).toBeDefined();
    expect(resumeHandlerSource).not.toContain("buildImageGenerateRequestPayload");
    expect(resumeHandlerSource).not.toContain("createImageGenerationAttempt");
    expect(resumeHandlerSource).not.toContain("randomUUID");
    expect(imagePageSource).not.toContain("useEffect(() => resumeImageGenerationRequest");
  });

  it("creates retry attempts only after acquiring the shared POST lock without rebuilding payloads", () => {
    const retryHandlerSource = imagePageSource
      .split("async function retryImageGenerationAsNewRequest()", 2)[1]
      ?.split("function handlePromptKeyDown", 1)[0];
    const sharedSenderSource = imagePageSource
      .split("async function sendAndReconcileImageGenerationAttempt", 2)[1]
      ?.split("async function resumeImageGenerationRequest", 1)[0];

    expect(retryHandlerSource).toBeDefined();
    expect(retryHandlerSource).not.toContain("buildImageGenerateRequestPayload");
    expect(retryHandlerSource?.match(/createImageGenerationAttempt/g)).toHaveLength(1);
    expect(retryHandlerSource?.indexOf("acquireImageGenerationPostLock")).toBeLessThan(
      retryHandlerSource?.indexOf("createImageGenerationAttempt") ?? -1
    );
    expect(retryHandlerSource).not.toContain("randomUUID");
    expect(sharedSenderSource).not.toContain("acquireImageGenerationPostLock");
    expect(imagePageSource).not.toContain(
      "useEffect(() => retryImageGenerationAsNewRequest"
    );
  });
});
