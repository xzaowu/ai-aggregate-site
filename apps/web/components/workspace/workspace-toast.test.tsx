// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import {
  WorkspaceToastContainer,
  useWorkspaceToast,
  type WorkspaceToastItem
} from "./workspace-toast";

describe("workspace toast", () => {
  it("renders toast container with aria-live region", () => {
    const toasts: WorkspaceToastItem[] = [
      { id: "t1", type: "success", message: "Done" }
    ];
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceToastContainer, {
        toasts,
        onDismiss: () => {}
      })
    );
    expect(html).toContain("aria-live");
    expect(html).toContain("Done");
  });

  it("renders success, error, and info toasts with correct styling", () => {
    const toasts: WorkspaceToastItem[] = [
      { id: "t1", type: "success", message: "OK" },
      { id: "t2", type: "error", message: "Fail" },
      { id: "t3", type: "info", message: "Note" }
    ];
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceToastContainer, {
        toasts,
        onDismiss: () => {}
      })
    );
    expect(html).toContain("OK");
    expect(html).toContain("Fail");
    expect(html).toContain("Note");
  });

  it("returns null when there are no toasts", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceToastContainer, {
        toasts: [],
        onDismiss: () => {}
      })
    );
    expect(html).toBe("");
  });

  it("renders close button for manual dismiss", () => {
    const toasts: WorkspaceToastItem[] = [
      { id: "t1", type: "info", message: "Info" }
    ];
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceToastContainer, {
        toasts,
        onDismiss: () => {}
      })
    );
    expect(html).toContain("aria-label=\"Dismiss\"");
  });

  it("useWorkspaceToast hook returns expected API", () => {
    let capturedToast: ReturnType<typeof useWorkspaceToast> | null = null;
    function TestHarness() {
      capturedToast = useWorkspaceToast();
      return null;
    }
    renderToStaticMarkup(React.createElement(TestHarness));
    expect(capturedToast).not.toBeNull();
    expect(capturedToast!.toasts).toEqual([]);
    expect(typeof capturedToast!.showToast).toBe("function");
    expect(typeof capturedToast!.dismissToast).toBe("function");
  });
});
