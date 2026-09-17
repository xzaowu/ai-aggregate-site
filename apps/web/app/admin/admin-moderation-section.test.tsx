// @vitest-environment jsdom

import type { AiProviderAccountSummary } from "@ai-aggregate/shared";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import { AdminModerationSection } from "./admin-moderation-section";
import type {
  AdminModerationSettings,
  ModerationCircuitBreakerStatus,
  ModerationRouteTestResponse
} from "./admin-moderation";

const account: AiProviderAccountSummary = {
  id: "account_1",
  name: "Safety Primary",
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://provider.example/v1",
  capabilities: ["chat"],
  enabled: true,
  priority: 1,
  timeoutMs: 3000,
  configJson: { moderation: { requestFormat: "openai-moderation" } },
  notes: null,
  hasApiKey: true,
  hasCustomHeaders: false,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z"
};

const settings: AdminModerationSettings = {
  version: 1,
  enabled: true,
  routes: [
    {
      id: "route_1",
      providerAccountId: account.id,
      providerAccountName: account.name,
      providerAccountEnabled: true,
      providerAccountCompatible: true,
      upstreamModel: "omni-moderation-latest",
      endpointPath: "/v1/moderations",
      priority: 1,
      enabled: true,
      timeoutMs: null,
      supportsText: true,
      supportsImage: true
    }
  ]
};

const blockedResult: ModerationRouteTestResponse = {
  routeId: "route_1",
  compatible: true,
  text: {
    supported: true,
    ok: true,
    decision: "blocked",
    latencyMs: 18,
    errorType: null
  },
  image: {
    supported: true,
    ok: true,
    decision: "allowed",
    latencyMs: 22,
    errorType: null
  }
};

const breakerStatus: ModerationCircuitBreakerStatus = {
  settings: {
    version: 1,
    enabled: true,
    failureThreshold: 3,
    cooldownMs: 60000
  },
  epoch: 2,
  routes: [
    {
      routeId: "route_1",
      inputType: "text",
      state: "closed",
      consecutiveFailures: 0,
      openedAt: null,
      retryAt: null,
      lastFailureAt: null,
      lastFailureType: null,
      lastSuccessAt: 1000,
      opens: 0,
      recoveries: 0,
      skips: 0
    }
  ]
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let interactionHost: HTMLDivElement | null = null;
let interactionRoot: Root | null = null;
let restoreDialogMethods: (() => void) | null = null;

function mockNativeDialogMethods() {
  const dialogPrototype = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  const originalShowModal = dialogPrototype.showModal;
  const originalClose = dialogPrototype.close;

  Object.defineProperty(dialogPrototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    }
  });
  Object.defineProperty(dialogPrototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    }
  });

  return () => {
    if (originalShowModal) {
      Object.defineProperty(dialogPrototype, "showModal", {
        configurable: true,
        value: originalShowModal
      });
    } else {
      Reflect.deleteProperty(dialogPrototype, "showModal");
    }
    if (originalClose) {
      Object.defineProperty(dialogPrototype, "close", {
        configurable: true,
        value: originalClose
      });
    } else {
      Reflect.deleteProperty(dialogPrototype, "close");
    }
  };
}

beforeEach(() => {
  restoreDialogMethods = mockNativeDialogMethods();
  interactionHost = document.createElement("div");
  document.body.append(interactionHost);
});

afterEach(async () => {
  await act(async () => interactionRoot?.unmount());
  interactionRoot = null;
  interactionHost?.remove();
  interactionHost = null;
  restoreDialogMethods?.();
  restoreDialogMethods = null;
});

function renderSection(
  overrides: Partial<React.ComponentProps<typeof AdminModerationSection>> = {}
) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
    >
      <AdminModerationSection
        settings={settings}
        loadState="ready"
        loadError={null}
        accounts={[account]}
        testResults={{}}
        testingRouteIds={new Set()}
        savingSettings={false}
        savingRouteId={null}
        deletingRouteId={null}
        circuitBreakerStatus={{ ...breakerStatus, settings: { ...breakerStatus.settings, enabled: false }, routes: [] }}
        circuitBreakerLoadState="ready"
        circuitBreakerLoadError={null}
        savingCircuitBreakerSettings={false}
        resettingCircuitBreaker={false}
        inputClass="input"
        checkboxClass="checkbox"
        primaryButtonClass="primary"
        iconButtonClass="icon"
        toggleInlineClass="toggle"
        onReload={vi.fn()}
        onToggleEnabled={vi.fn()}
        onCreateRoute={vi.fn()}
        onUpdateRoute={vi.fn()}
        onDeleteRoute={vi.fn()}
        onTestRoute={vi.fn()}
        onReloadCircuitBreaker={vi.fn()}
        onSaveCircuitBreakerSettings={vi.fn()}
        onResetCircuitBreaker={vi.fn()}
        {...overrides}
      />
    </I18nContext.Provider>
  );
}

async function mountSection(
  overrides: Partial<React.ComponentProps<typeof AdminModerationSection>> = {}
) {
  if (!interactionHost) throw new Error("missing interaction host");
  interactionRoot = createRoot(interactionHost);
  await act(async () => {
    interactionRoot?.render(
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
      >
        <AdminModerationSection
          settings={settings}
          loadState="ready"
          loadError={null}
          accounts={[account]}
          testResults={{}}
          testingRouteIds={new Set()}
          savingSettings={false}
          savingRouteId={null}
          deletingRouteId={null}
          circuitBreakerStatus={{ ...breakerStatus, settings: { ...breakerStatus.settings, enabled: false }, routes: [] }}
          circuitBreakerLoadState="ready"
          circuitBreakerLoadError={null}
          savingCircuitBreakerSettings={false}
          resettingCircuitBreaker={false}
          inputClass="input"
          checkboxClass="checkbox"
          primaryButtonClass="primary"
          iconButtonClass="icon"
          toggleInlineClass="toggle"
          onReload={vi.fn()}
          onToggleEnabled={vi.fn()}
          onCreateRoute={vi.fn()}
          onUpdateRoute={vi.fn()}
          onDeleteRoute={vi.fn()}
          onTestRoute={vi.fn()}
          onReloadCircuitBreaker={vi.fn()}
          onSaveCircuitBreakerSettings={vi.fn()}
          onResetCircuitBreaker={vi.fn()}
          {...overrides}
        />
      </I18nContext.Provider>
    );
    await Promise.resolve();
  });
  return interactionHost;
}

describe("admin moderation section", () => {
  it("renders an independent loading state", () => {
    const html = renderSection({ settings: null, loadState: "loading" });
    expect(html).toContain("Content Safety");
    expect(html).toContain("Loading admin data...");
    expect(html).toContain('role="status"');
  });

  it("renders an independent error state with retry", () => {
    const html = renderSection({ settings: null, loadState: "error", loadError: "Content Safety settings could not be loaded." });
    expect(html).toContain("Content Safety settings could not be loaded.");
    expect(html).toContain("Retry moderation load");
    expect(html).toContain('role="alert"');
  });

  it("renders empty route state without claiming coverage", () => {
    const html = renderSection({ settings: { version: 1, enabled: false, routes: [] } });
    expect(html).toContain("No moderation routes yet");
    expect(html).toContain("Text coverage");
    expect(html).toContain("Missing");
    expect(html).toContain("Image coverage");
  });

  it("renders coverage summary, account status, route fields, and inherited timeout", () => {
    const html = renderSection();
    expect(html).toContain("Global moderation");
    expect(html).toContain("Compatible account routes");
    expect(html).toContain("Text coverage");
    expect(html).toContain("Image coverage");
    expect(html).toContain("Safety Primary");
    expect(html).toContain("omni-moderation-latest");
    expect(html).toContain("/v1/moderations");
    expect(html).toContain("Inherit account/safe default");
    expect(html).toContain("Can participate");
    expect(html).toContain("Not tested");
  });

  it("keeps compatible=true blocked results in the warning state", () => {
    const html = renderSection({ testResults: { route_1: blockedResult } });
    expect(html).toContain("Protocol compatible, safety sample blocked");
    expect(html).toContain("Compatible, but safety sample was blocked");
    expect(html).not.toContain(">Route test passed<");
  });

  it("shows disabled, missing, and incompatible route states as text", () => {
    const html = renderSection({
      settings: {
        version: 1,
        enabled: false,
        routes: [
          { ...settings.routes[0]!, id: "disabled", enabled: false },
          { ...settings.routes[0]!, id: "missing", providerAccountName: null },
          { ...settings.routes[0]!, id: "incompatible", providerAccountCompatible: false }
        ]
      }
    });
    expect(html).toContain("Route disabled");
    expect(html).toContain("Provider account missing");
    expect(html).toContain("Moderation incompatible");
  });

  it("renders mobile cards and keyboard-reachable actions", () => {
    const html = renderSection();
    expect(html).toContain("md:hidden");
    expect(html).toContain("aria-label=\"Test route: omni-moderation-latest\"");
    expect(html).toContain("Edit");
    expect(html).toContain("Delete");
  });

  it("renders independent loading controls for concurrent route tests", async () => {
    const host = await mountSection({
      settings: {
        ...settings,
        routes: [
          settings.routes[0]!,
          { ...settings.routes[0]!, id: "route_2", upstreamModel: "second-model" }
        ]
      },
      testingRouteIds: new Set(["route_1", "route_2"])
    });
    const firstButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Test route: omni-moderation-latest"]'
    );
    const secondButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Test route: second-model"]'
    );
    expect(firstButton?.disabled).toBe(true);
    expect(secondButton?.disabled).toBe(true);
    expect(host.textContent).toContain("Testing moderation route...");
  });

  it("calls the global toggle callback and route test callback without a test body concern", async () => {
    const onToggleEnabled = vi.fn();
    const onTestRoute = vi.fn();
    const host = await mountSection({ onToggleEnabled, onTestRoute });
    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Enable moderation globally"]');
    expect(toggle).toBeTruthy();
    if (toggle) {
      await act(async () => toggle.click());
    }
    expect(onToggleEnabled).toHaveBeenCalledWith(false);
    const testButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Test route"));
    expect(testButton).toBeTruthy();
    await act(async () => testButton?.click());
    expect(onTestRoute).toHaveBeenCalledWith("route_1");
  });

  it("opens create and delete confirmation interactions", async () => {
    const onDeleteRoute = vi.fn().mockResolvedValue(true);
    const host = await mountSection({ onDeleteRoute });
    const createButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Create moderation route"));
    expect(createButton).toBeTruthy();
    await act(async () => createButton?.click());
    expect(host.textContent).toContain("Route configuration");

    const deleteButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Delete"));
    expect(deleteButton).toBeTruthy();
    await act(async () => deleteButton?.click());
    expect(host.textContent).toContain("The provider account will not be deleted");
    const confirm = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Delete moderation route"));
    expect(confirm).toBeTruthy();
    await act(async () => confirm?.click());
    expect(onDeleteRoute).toHaveBeenCalledWith("route_1");
  });

  it("keeps shared drawer dialog semantics and moderation content", async () => {
    const host = await mountSection();
    const createButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Create moderation route")
    );
    expect(createButton).toBeTruthy();

    await act(async () => createButton?.click());

    const dialog = host.querySelector<HTMLDialogElement>(
      'dialog[data-admin-drawer-dialog="true"]'
    );
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    const titleId = dialog?.getAttribute("aria-labelledby");
    const descriptionId = dialog?.getAttribute("aria-describedby");
    expect(host.querySelector(`[id="${titleId}"]`)).toBeTruthy();
    expect(host.querySelector(`[id="${descriptionId}"]`)).toBeTruthy();
    expect(dialog?.querySelector('[data-admin-drawer-close="true"]')).toBeTruthy();
    expect(dialog?.textContent).toContain("Route configuration");
    expect(dialog?.textContent).toContain("Create moderation route");
    expect(dialog?.querySelector('button[type="button"]')).toBeTruthy();
  });

  it("keeps the moderation route table visible while breaker status loads", () => {
    const html = renderSection({
      circuitBreakerStatus: null,
      circuitBreakerLoadState: "loading"
    });
    expect(html).toContain("Loading circuit-breaker status...");
    expect(html).toContain("omni-moderation-latest");
    expect(html).toContain("Safety Primary");
  });

  it("keeps the moderation route table visible when breaker loading fails", () => {
    const onReloadCircuitBreaker = vi.fn();
    const html = renderSection({
      circuitBreakerStatus: null,
      circuitBreakerLoadState: "error",
      circuitBreakerLoadError: "Circuit-breaker status could not be loaded.",
      onReloadCircuitBreaker
    });
    expect(html).toContain("Circuit-breaker status could not be loaded.");
    expect(html).toContain("Refresh");
    expect(html).toContain("omni-moderation-latest");
  });

  it("renders disabled and enabled breaker settings", () => {
    const disabled = renderSection({
      circuitBreakerStatus: {
        ...breakerStatus,
        settings: { ...breakerStatus.settings, enabled: false },
        routes: []
      }
    });
    const enabled = renderSection({ circuitBreakerStatus: breakerStatus });
    expect(disabled).toContain("Enable circuit breaker");
    expect(disabled).toContain("Disabled");
    expect(enabled).toContain("Enabled");
    expect(enabled).toContain("Failure threshold");
    expect(enabled).toContain("Cooldown (ms)");
  });

  it("renders closed, open, and half-open states with text input labels", () => {
    const html = renderSection({
      circuitBreakerStatus: {
        ...breakerStatus,
        routes: [
          breakerStatus.routes[0]!,
          { ...breakerStatus.routes[0]!, routeId: "route_2", inputType: "image", state: "open", consecutiveFailures: 3, lastFailureType: "request_error" },
          { ...breakerStatus.routes[0]!, routeId: "route_3", inputType: "text", state: "half_open" }
        ]
      }
    });
    expect(html).toContain("Closed");
    expect(html).toContain("Open");
    expect(html).toContain("Half-open");
    expect(html).toContain("Text");
    expect(html).toContain("Image");
  });

  it("renders the empty runtime state without claiming routes are absent", () => {
    const html = renderSection({
      circuitBreakerStatus: { ...breakerStatus, routes: [] }
    });
    expect(html).toContain("No runtime status yet");
    expect(html).toContain("Runtime entries appear only after actual moderation requests");
    expect(html).not.toContain("No moderation routes yet");
  });

  it("cross-references configured routes and falls back to an unknown route id", () => {
    const html = renderSection({
      circuitBreakerStatus: {
        ...breakerStatus,
        routes: [
          breakerStatus.routes[0]!,
          { ...breakerStatus.routes[0]!, routeId: "deleted_route", inputType: "image" }
        ]
      }
    });
    expect(html).toContain("Safety Primary");
    expect(html).toContain("omni-moderation-latest");
    expect(html).toContain("deleted_route");
  });

  it("does not call save for an invalid form", async () => {
    const onSaveCircuitBreakerSettings = vi.fn();
    const host = await mountSection({ onSaveCircuitBreakerSettings });
    const threshold = host.querySelector<HTMLInputElement>(
      'input[aria-label="Failure threshold"]'
    );
    expect(threshold).toBeTruthy();
    if (threshold) {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )?.set;
        setter?.call(threshold, "21");
        threshold.dispatchEvent(new Event("input", { bubbles: true }));
        threshold.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    const submit = host.querySelector<HTMLButtonElement>('form button[type="submit"]');
    await act(async () => submit?.click());
    expect(onSaveCircuitBreakerSettings).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Failure threshold must be an integer from 1 to 20.");
  });

  it("sends the exact valid settings payload through the save callback", async () => {
    const onSaveCircuitBreakerSettings = vi.fn().mockResolvedValue(true);
    const host = await mountSection({ onSaveCircuitBreakerSettings });
    const submit = host.querySelector<HTMLButtonElement>('form button[type="submit"]');
    await act(async () => submit?.click());
    expect(onSaveCircuitBreakerSettings).toHaveBeenCalledWith({
      version: 1,
      enabled: false,
      failureThreshold: 3,
      cooldownMs: 60000
    });
  });

  it("disables save while settings are being saved", () => {
    const html = renderSection({ savingCircuitBreakerSettings: true });
    expect(html).toContain("Saving...");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Saving\.\.\./s);
  });

  it("opens and cancels the reset confirmation without calling reset", async () => {
    const onResetCircuitBreaker = vi.fn();
    const host = await mountSection({ onResetCircuitBreaker });
    const reset = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Reset runtime")
    );
    await act(async () => reset?.click());
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    const cancel = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((button) =>
      button.textContent?.includes("Cancel")
    );
    await act(async () => cancel?.click());
    expect(onResetCircuitBreaker).not.toHaveBeenCalled();
  });

  it("confirms reset only once and disables the reset action while busy", async () => {
    const onResetCircuitBreaker = vi.fn().mockResolvedValue(true);
    const host = await mountSection({ onResetCircuitBreaker });
    const reset = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Reset runtime")
    );
    await act(async () => reset?.click());
    const confirm = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((button) =>
      button.textContent?.includes("Reset runtime")
    );
    await act(async () => {
      confirm?.click();
      confirm?.click();
      await Promise.resolve();
    });
    expect(onResetCircuitBreaker).toHaveBeenCalledTimes(1);

    const busyHtml = renderSection({ resettingCircuitBreaker: true });
    const busyHost = document.createElement("div");
    busyHost.innerHTML = busyHtml;
    const busyReset = Array.from(busyHost.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Resetting...")
    ) as HTMLButtonElement | undefined;
    expect(busyReset?.disabled).toBe(true);
  });

  it("renders mobile runtime cards", () => {
    const html = renderSection({ circuitBreakerStatus: breakerStatus });
    expect(html).toContain("md:hidden");
    expect(html).toContain("Safety Primary");
  });
});
