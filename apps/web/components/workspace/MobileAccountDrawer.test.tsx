// @vitest-environment jsdom

import React, { act, StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileAccountDrawer } from "./MobileAccountDrawer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ pending = false, onClose = vi.fn() }: { pending?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <><button ref={triggerRef} type="button" data-trigger onClick={() => setOpen(true)}>Open</button>{open ? <MobileAccountDrawer title="Check-in" labelledBy="drawer-title" variant="bottom" pending={pending} returnFocusRef={triggerRef} onClose={() => { onClose(); setOpen(false); }} closeLabel="Close"><p>Drawer content</p></MobileAccountDrawer> : null}</>;
}

describe("MobileAccountDrawer", () => {
  let host: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    document.body.style.overflow = "";
    window.history.replaceState(null, "", "/account");
  });

  it("keeps /account, exposes one accessible dialog, locks scroll, and returns focus on Escape", async () => {
    const onClose = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    window.history.replaceState(null, "", "/account");
    root = createRoot(host);
    await act(async () => root?.render(<Harness onClose={onClose} />));
    expect(window.location.pathname).toBe("/account");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => Promise.resolve());
    expect(document.activeElement?.getAttribute("data-trigger")).toBe("true");
    expect(document.body.style.overflow).toBe("");
  });

  it("does not close while a mutation is pending", async () => {
    const onClose = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<Harness pending onClose={onClose} />));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      document.querySelector<HTMLElement>('[role="dialog"]')?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')?.disabled).toBe(true);
  });

  it("keeps the dialog open through StrictMode effect replay and cleans its own marker", async () => {
    const onClose = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    window.history.replaceState(null, "", "/account");
    root = createRoot(host);
    await act(async () => root?.render(<StrictMode><Harness onClose={onClose} /></StrictMode>));

    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(window.history.state?.accountDrawer).toBe("m5");
    expect(window.location.pathname).toBe("/account");

    await act(async () => {
      const popstate = new Promise<void>((resolve) => {
        window.addEventListener("popstate", () => resolve(), { once: true });
      });
      document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')?.click();
      await popstate;
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(window.history.state?.accountDrawer).toBeUndefined();
    expect(window.location.pathname).toBe("/account");
  });
});
