// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../../lib/i18n/use-i18n";
import { VideoWorkflowCanvas } from "./video-workflow-canvas";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@xyflow/react", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
    Handle: ({ id, type }: { id: string; type: string }) =>
      ReactModule.createElement("span", { "data-handle-id": id, "data-handle-type": type }),
    Background: () => ReactModule.createElement("div", { "data-react-flow-background": "true" }),
    Controls: () => ReactModule.createElement("div", { "data-react-flow-controls": "true" }),
    ReactFlow: ({
      nodes,
      edges,
      nodeTypes,
      onConnect,
      isValidConnection,
      children
    }: {
      nodes: Array<{ id: string; type: string; data: unknown }>;
      edges: Array<{ id: string }>;
      nodeTypes: Record<string, React.ComponentType<Record<string, unknown>>>;
      onConnect: (connection: Record<string, string>) => void;
      isValidConnection: (connection: Record<string, string>) => boolean;
      children?: React.ReactNode;
    }) => {
      const invalidConnection = {
        source: "workflow-prompt",
        sourceHandle: "output",
        target: "workflow-result",
        targetHandle: "input"
      };
      return ReactModule.createElement(
        "div",
        {
          "data-mock-react-flow": "true",
          "data-node-count": String(nodes.length),
          "data-edge-count": String(edges.length)
        },
        ...nodes.map((node) => {
          const Component = nodeTypes[node.type];
          return Component
            ? ReactModule.createElement(Component, {
                key: node.id,
                id: node.id,
                data: node.data,
                type: node.type,
                selected: false,
                dragging: false,
                draggable: true,
                selectable: true,
                deletable: false,
                zIndex: 0,
                isConnectable: true,
                positionAbsoluteX: 0,
                positionAbsoluteY: 0
              })
            : null;
        }),
        ReactModule.createElement(
          "button",
          {
            type: "button",
            "data-test-invalid-connection": "true",
            "data-connection-valid": String(isValidConnection(invalidConnection)),
            onClick: () => onConnect(invalidConnection)
          },
          "Try invalid connection"
        ),
        children
      );
    }
  };
});

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function setValue(element: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
      >
        <VideoWorkflowCanvas modelLabel="Seedance" />
      </I18nContext.Provider>
    );
  });
  await settle();
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      media: "(min-width: 768px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VideoWorkflowCanvas", () => {
  it("renders the three-node T2V template and edits the prompt locally", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await mount();

    expect(host?.querySelector("[data-mock-react-flow]")?.getAttribute("data-node-count")).toBe("3");
    expect(host?.querySelectorAll("[data-handle-id]")).toHaveLength(4);

    const prompt = host?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow prompt"]');
    if (!prompt) throw new Error("WORKFLOW_PROMPT_MISSING");
    await act(async () => setValue(prompt, "A local workflow prompt"));
    expect(prompt.value).toBe("A local workflow prompt");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("switches to the four-node I2V template", async () => {
    await mount();
    const i2v = host?.querySelector<HTMLButtonElement>(
      '[data-workflow-mode-button="image-to-video"]'
    );
    if (!i2v) throw new Error("WORKFLOW_I2V_BUTTON_MISSING");

    await act(async () => i2v.click());

    expect(host?.querySelector("[data-mock-react-flow]")?.getAttribute("data-node-count")).toBe("4");
    expect(host?.querySelector('[data-video-workflow-mode="image-to-video"]')).toBeTruthy();
    expect(host?.textContent).toContain("Reference Image");
  });

  it("rejects an invalid typed connection", async () => {
    await mount();
    const invalidConnection = host?.querySelector<HTMLButtonElement>(
      "[data-test-invalid-connection]"
    );
    if (!invalidConnection) throw new Error("INVALID_CONNECTION_PROBE_MISSING");
    expect(invalidConnection.dataset.connectionValid).toBe("false");
    expect(host?.querySelector("[data-mock-react-flow]")?.getAttribute("data-edge-count")).toBe("2");

    await act(async () => invalidConnection.click());

    expect(host?.querySelector("[data-mock-react-flow]")?.getAttribute("data-edge-count")).toBe("2");
  });

  it("keeps video execution disabled and never calls the generation endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await mount();

    const execution = Array.from(host?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent?.includes("Execution integration pending"));
    expect(execution?.disabled).toBe(true);
    execution?.click();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
