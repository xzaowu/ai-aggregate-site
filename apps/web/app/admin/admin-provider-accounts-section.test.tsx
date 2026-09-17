// @vitest-environment jsdom

import type {
  AiModelRouteSummary,
  AdminAiModelSummary,
  AiProviderAccountSummary
} from "@ai-aggregate/shared";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import { authTokenKey, authUserKey } from "../../components/auth-state";
import { AdminAuthProvider } from "./admin-auth-context";
import { AdminModelProviderAccountSelect } from "./admin-model-provider-account-select";
import AdminPage from "./admin-page-client";
import {
  AdminProviderAccountsSection,
  mergeProviderAccountConfigJson,
  parseProviderAccountCapabilitiesInput,
  parseProviderAccountTestPayload,
  providerAccountToForm,
  type ProviderAccountFormState
} from "./admin-provider-accounts-section";
import { AdminModelRoutesEditor } from "./admin-model-routes-editor";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/provider-accounts",
  useRouter: (() => {
    const router = { replace: vi.fn() };
    return () => router;
  })()
}));

const inputClass = "input-class";
const checkboxClass = "checkbox-class";
const primaryButtonClass = "primary-button-class";
const toggleInlineClass = "toggle-inline-class";
const iconButtonClass = "icon-button-class";

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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const account: AiProviderAccountSummary = {
  id: "provider_account_1",
  name: "OpenRouter backup",
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://secret-token@openrouter.example/v1?api_key=hidden",
  capabilities: ["chat", "image"],
  enabled: true,
  priority: 10,
  timeoutMs: 45000,
  configJson: {
    region: "global",
    requestFormat: "anthropic",
    anthropicAuthMode: "both",
    messagesPath: "/v1/messages",
    testModel: "claude-3-5-haiku-latest"
  },
  notes: "backup account",
  hasApiKey: true,
  hasCustomHeaders: true,
  createdAt: "2026-06-22T00:00:00.000Z",
  updatedAt: "2026-06-22T00:00:00.000Z"
};

const form: ProviderAccountFormState = {
  name: "",
  providerType: "SUB2API",
  requestFormat: "openai-compatible",
  anthropicAuthMode: "x-api-key",
  messagesPath: "",
  testModel: "",
  testCapability: "chat",
  baseUrl: "",
  apiKey: "",
  capabilitiesText: "chat",
  enabled: true,
  priority: "0",
  timeoutMs: "60000",
  headersJson: "",
  configJson: "",
  notes: ""
};

function renderWithI18n(node: React.ReactNode) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale: "en-US",
        setLocale: vi.fn(),
        t: createTranslator("en-US")
      }}
    >
      {node}
    </I18nContext.Provider>
  );
}

function renderProviderAccountsSection(
  overrides: Partial<React.ComponentProps<typeof AdminProviderAccountsSection>> = {}
) {
  return renderWithI18n(
    <AdminProviderAccountsSection
      accounts={[account]}
      newAccount={form}
      accountInputs={{ [account.id]: providerAccountToForm(account) }}
      creatingAccount={false}
      savingAccountId={null}
      testingNewAccount={false}
      testingAccountId={null}
      testResults={{}}
      inputClass={inputClass}
      checkboxClass={checkboxClass}
      primaryButtonClass={primaryButtonClass}
      iconButtonClass={iconButtonClass}
      toggleInlineClass={toggleInlineClass}
      onNewAccountChange={vi.fn()}
      onAccountInputChange={vi.fn()}
      onCreateAccount={vi.fn()}
      onUpdateAccount={vi.fn()}
      onDisableAccount={vi.fn()}
      onTestNewAccount={vi.fn()}
      onTestAccount={vi.fn()}
      {...overrides}
    />
  );
}

async function mountProviderAccountsSection(
  overrides: Partial<React.ComponentProps<typeof AdminProviderAccountsSection>> = {}
) {
  if (!interactionHost) throw new Error("missing interaction host");
  interactionRoot = createRoot(interactionHost);
  await act(async () => {
    interactionRoot?.render(
      <I18nContext.Provider
        value={{
          locale: "en-US",
          setLocale: vi.fn(),
          t: createTranslator("en-US")
        }}
      >
        <AdminProviderAccountsSection
          accounts={[account]}
          newAccount={form}
          accountInputs={{ [account.id]: providerAccountToForm(account) }}
          creatingAccount={false}
          savingAccountId={null}
          testingNewAccount={false}
          testingAccountId={null}
          testResults={{}}
          inputClass={inputClass}
          checkboxClass={checkboxClass}
          primaryButtonClass={primaryButtonClass}
          iconButtonClass={iconButtonClass}
          toggleInlineClass={toggleInlineClass}
          onNewAccountChange={vi.fn()}
          onAccountInputChange={vi.fn()}
          onCreateAccount={vi.fn()}
          onUpdateAccount={vi.fn()}
          onDisableAccount={vi.fn()}
          onTestNewAccount={vi.fn()}
          onTestAccount={vi.fn()}
          {...overrides}
        />
      </I18nContext.Provider>
    );
    await Promise.resolve();
  });
  return interactionHost;
}

function adminJsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function createAdminPageFetch(
  testResponse: Response | Promise<Response>,
  providerAccount: AiProviderAccountSummary = account
) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes("/admin/provider-accounts/test")) {
      return testResponse;
    }
    if (url.includes("/admin/provider-accounts")) {
      return adminJsonResponse({ providerAccounts: [providerAccount] });
    }
    if (url.includes("/admin/moderation/circuit-breaker")) {
      return adminJsonResponse({
        settings: {
          version: 1,
          enabled: false,
          failureThreshold: 3,
          cooldownMs: 60000
        },
        epoch: 0,
        routes: []
      });
    }
    if (url.includes("/admin/moderation")) {
      return adminJsonResponse({ version: 1, enabled: false, routes: [] });
    }
    return adminJsonResponse({});
  });
}

async function flushAdminPage() {
  for (let index = 0; index < 8; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountAdminPageForProviderTest(
  testResponse: Response | Promise<Response>,
  providerAccount: AiProviderAccountSummary = account
) {
  if (!interactionHost) throw new Error("missing interaction host");
  window.localStorage.setItem(authTokenKey, "admin-test-token");
  window.localStorage.setItem(
    authUserKey,
    JSON.stringify({
      id: "admin-test-user",
      email: "admin@example.com",
      role: "ADMIN",
      credits: 0
    })
  );
  const fetchImpl = createAdminPageFetch(testResponse, providerAccount);
  vi.stubGlobal("fetch", fetchImpl);
  interactionRoot = createRoot(interactionHost);
  await act(async () => {
    interactionRoot?.render(
      <I18nContext.Provider
        value={{
          locale: "en-US",
          setLocale: vi.fn(),
          t: createTranslator("en-US")
        }}
      >
        <AdminAuthProvider>
          <AdminPage />
        </AdminAuthProvider>
      </I18nContext.Provider>
    );
  });
  await flushAdminPage();
  return fetchImpl;
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(interactionHost?.querySelectorAll("button") ?? []).find(
    (button): button is HTMLButtonElement => button.textContent?.trim() === label
  );
}

function findStaticButton(html: string, label: string): HTMLButtonElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  const button = Array.from(host.querySelectorAll("button")).find(
    (item): item is HTMLButtonElement => item.textContent?.trim() === label
  );
  if (!button) throw new Error(`missing static button: ${label}`);
  return button;
}

async function clickButton(label: string) {
  const button = findButton(label);
  expect(button).toBeTruthy();
  if (!button) throw new Error(`missing button: ${label}`);
  await act(async () => {
    button.click();
  });
}

function findDrawerButton(label: string): HTMLButtonElement | undefined {
  const drawer = Array.from(interactionHost?.querySelectorAll("aside") ?? []).at(-1);

  return Array.from(drawer?.querySelectorAll("button") ?? []).find(
    (button): button is HTMLButtonElement => button.textContent?.trim() === label
  );
}

function findDrawerInput(labelText: string): HTMLInputElement | undefined {
  const drawer = Array.from(interactionHost?.querySelectorAll("aside") ?? []).at(-1);

  return Array.from(drawer?.querySelectorAll("label") ?? [])
    .find((label) => label.textContent?.includes(labelText))
    ?.querySelector("input") as HTMLInputElement | undefined;
}

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function setSelectValue(select: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    )?.set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("admin provider account UI", () => {
  it("renders a table-based provider account list without leaking URL tokens or full API keys", () => {
    const html = renderProviderAccountsSection();

    expect(html).toContain("Provider Accounts");
    expect(html).toContain(
      "reusable upstream connection, credential, and transport profiles"
    );
    expect(html).toContain("<table");
    expect(html).toContain("Account name");
    expect(html).toContain("Provider type");
    expect(html).toContain("Request format");
    expect(html).toContain("Base URL");
    expect(html).toContain("Capabilities");
    expect(html).toContain("Priority");
    expect(html).toContain("Timeout ms");
    expect(html).toContain("Test status");
    expect(html).toContain("Enabled");
    expect(html).toContain("Actions");
    expect(html).toContain("OpenRouter backup");
    expect(html).toContain("OPENAI_COMPATIBLE");
    expect(html).toContain("Anthropic Messages (/v1/messages)");
    expect(html).toContain("https://openrouter.example/v1");
    expect(html).toContain("Chat");
    expect(html).toContain("Image");
    expect(html).toContain("Test connection");
    expect(html).toContain("Edit account");
    expect(html).toContain("Disable account");
    expect(html).not.toContain("secret-token");
    expect(html).not.toContain("api_key=hidden");
    expect(html).not.toContain("sk-live-full-secret");
    expect(html).not.toContain("sk-live...abcd");
    expect(html).not.toContain("API key");
  });

  it("keeps provider identity, status, and actions primary on narrow data surfaces", () => {
    const host = document.createElement("div");
    host.innerHTML = renderProviderAccountsSection();
    const table = host.querySelector('table[data-admin-data-surface="provider-accounts"]');
    const headers = Array.from(
      table?.querySelectorAll<HTMLTableCellElement>("thead th") ?? []
    );

    expect(host.querySelector('[data-admin-data-region="true"]')).toBeTruthy();
    expect(
      headers.find((header) => header.textContent?.includes("Account name"))?.dataset
        .adminColumnPriority
    ).toBe("primary");
    const baseUrlHeader = headers.find((header) => header.textContent?.includes("Base URL"));
    expect(baseUrlHeader?.dataset.adminColumnPriority).toBe("tertiary");
    expect(baseUrlHeader?.className).toContain("hidden lg:table-cell");
    expect(
      headers.find((header) => header.textContent?.includes("Test status"))?.dataset
        .adminColumnPriority
    ).toBe("primary");
    expect(
      headers.find((header) => header.textContent?.includes("Actions"))?.dataset
        .adminColumnPriority
    ).toBe("primary");
  });

  it("shows the saved API key state and blank-key test/save semantics when editing", async () => {
    const host = await mountProviderAccountsSection();

    await clickButton("Edit account");

    expect(host.textContent).toContain("API key configured");
    expect(host.textContent).toContain(
      "Leave blank when saving to keep the saved key. Test uses the saved key."
    );
    expect(host.textContent).toContain(
      "Custom request headers are configured. Leave blank to keep them, enter new JSON to replace them, or enter {} to clear them."
    );
    const drawer = Array.from(host.querySelectorAll("aside")).at(-1);
    expect(drawer?.textContent ?? "").not.toContain("sk-live...abcd");
    expect(host.textContent ?? "").not.toContain("sk-live...abcd");
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe(
      ""
    );
    const headersEditor = Array.from(host.querySelectorAll("details"))
      .find((details) =>
        details.querySelector("summary")?.textContent?.includes("Headers JSON")
      )
      ?.querySelector("textarea");
    expect(headersEditor?.value).toBe("");
  });

  it("shows the not-configured API key state without rendering a masked value", async () => {
    const unconfiguredAccount: AiProviderAccountSummary = {
      ...account,
      hasApiKey: false
    };
    const host = await mountProviderAccountsSection({
      accounts: [unconfiguredAccount],
      accountInputs: {
        [unconfiguredAccount.id]: providerAccountToForm(unconfiguredAccount)
      }
    });

    await clickButton("Edit account");

    expect(host.textContent).toContain("API key not configured");
    expect(host.textContent).toContain(
      "No API key is saved. If the upstream requires one, enter it to test; Save stores the current input on the account."
    );
    expect(host.textContent).not.toContain("sk-live...abcd");
  });

  it("shows the new unsaved API key copy for an unconfigured edited account", async () => {
    const unconfiguredAccount: AiProviderAccountSummary = {
      ...account,
      hasApiKey: false
    };
    const host = await mountAdminPageForProviderTest(
      adminJsonResponse({}),
      unconfiguredAccount
    );

    await clickButton("Edit account");
    const apiKeyInput = findDrawerInput("API key");
    expect(apiKeyInput).toBeTruthy();
    if (!apiKeyInput) throw new Error("missing API key input");

    await setInputValue(apiKeyInput, "new-secret");

    expect(interactionHost?.textContent).toContain(
      "A new API key is entered. Test uses it for this test only; Test does not save it. Save to persist it."
    );
    expect(interactionHost?.textContent).not.toContain(
      "A new API key is entered. Test uses it for this test only; Test does not save it. Save to replace the saved key."
    );
  });

  it("strictly parses capabilities without silently dropping invalid tokens", () => {
    const cases = [
      ["chat,image", ["chat", "image"], []],
      ["chat, image", ["chat", "image"], []],
      ["chat\nimage", ["chat", "image"], []],
      ["CHAT", [], ["CHAT"]],
      ["chat,foo", ["chat"], ["foo"]],
      ["chat,chat,image", ["chat", "image"], []],
      ["", [], []],
      ["   ", [], []],
      ["video,ppt", ["video", "ppt"], []],
      ["chat,image,video,ppt", ["chat", "image", "video", "ppt"], []],
      ["foo,chat,foo,bar", ["chat"], ["foo", "bar"]]
    ] as const;

    for (const [value, capabilities, invalidCapabilities] of cases) {
      expect(parseProviderAccountCapabilitiesInput(value)).toEqual({
        capabilities,
        invalidCapabilities
      });
    }
  });

  it("rehydrates existing summary capabilities in their original order", () => {
    expect(
      providerAccountToForm({
        ...account,
        capabilities: ["video", "ppt"]
      }).capabilitiesText
    ).toBe("video, ppt");
  });

  it("renders an inline unsupported-capability error and disables Provider Test", () => {
    const html = renderProviderAccountsSection({
      accounts: [],
      accountInputs: {},
      newAccount: { ...form, capabilitiesText: "chat,foo" }
    });
    const testButton = findStaticButton(html, "Test connection");

    expect(html).toContain("Unsupported capability: foo");
    expect(testButton.disabled).toBe(true);
    expect(
      parseProviderAccountTestPayload({
        ...form,
        baseUrl: "https://provider.example/v1",
        capabilitiesText: "chat,foo"
      })
    ).toBeNull();
  });

  it("renders create entry and grouped drawer content for an empty provider account list", () => {
    const html = renderProviderAccountsSection({
      accounts: [],
      accountInputs: {},
      newAccount: {
        ...form,
        providerType: "SUB2API",
        requestFormat: "anthropic",
        anthropicAuthMode: "both",
        messagesPath: "/v1/messages",
        testModel: "claude-3-5-haiku-latest"
      }
    });

    expect(html).toContain("No provider accounts yet");
    expect(html).toContain('data-admin-empty-state="true"');
    expect(html).toContain("Create account");
    expect(html).toContain("reusable upstream connection, credential, and transport profiles");
    expect(html).toContain("Basic");
    expect(html).toContain("Protocol");
    expect(html).toContain("Connection diagnostics");
    expect(html).toContain("do not save account configuration");
    expect(html).toContain("Advanced");
    expect(html).toContain("usually include /v1 in Base URL");
    expect(html).toContain("The app calls /chat/completions");
    expect(html).toContain("the app calls /v1/messages or configJson.messagesPath");
    expect(html).toContain("SUB2API Claude: requestFormat=anthropic and anthropicAuthMode=both are recommended.");
    expect(html).toContain("messagesPath");
    expect(html).toContain("Headers JSON");
    expect(html).toContain("Config JSON");
    expect(html).toContain("Do not clear it unless you know why.");
  });

  it("uses shared dialog and field semantics for the provider account drawer", async () => {
    const host = await mountProviderAccountsSection({
      accounts: [],
      accountInputs: {}
    });

    await clickButton("Create account");

    const dialog = host.querySelector<HTMLDialogElement>(
      'dialog[data-admin-drawer-dialog="true"]'
    );
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    const titleId = dialog?.getAttribute("aria-labelledby");
    const descriptionId = dialog?.getAttribute("aria-describedby");
    expect(titleId).toBeTruthy();
    expect(descriptionId).toBeTruthy();
    expect(host.querySelector(`[id="${titleId}"]`)).toBeTruthy();
    expect(host.querySelector(`[id="${descriptionId}"]`)).toBeTruthy();
    expect(dialog?.querySelector('[data-admin-drawer-close="true"]')).toBeTruthy();
    expect(host.querySelector('[data-admin-form-section="true"]')).toBeTruthy();
    expect(host.querySelector('[data-admin-form-actions="true"]')).toBeTruthy();

    const apiKeyInput = dialog?.querySelector<HTMLInputElement>('input[type="password"]');
    expect(apiKeyInput?.id).toMatch(/^admin-field-/);
    const describedBy = apiKeyInput?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(host.querySelector(`[id="${describedBy}"]`)).toBeTruthy();
  });

  it("requires an explicit multi-capability selector and shows the real-cost image warning", () => {
    const html = renderProviderAccountsSection({
      accounts: [],
      accountInputs: {},
      newAccount: {
        ...form,
        capabilitiesText: "chat, image",
        testCapability: "image"
      }
    });

    expect(html).toContain("测试能力 / Test capability");
    expect(html).toContain('value="image" selected');
    expect(html).toContain(
      "图像测试会发起一次真实上游生图请求，可能产生上游费用。"
    );
  });

  it("disables the drawer test without a testable capability or a multi-capability selection", () => {
    const noCapabilityButton = findStaticButton(
      renderProviderAccountsSection({
        accounts: [],
        accountInputs: {},
        newAccount: { ...form, capabilitiesText: "", testCapability: "" }
      }),
      "Test connection"
    );
    expect(noCapabilityButton.disabled).toBe(true);

    const unselectedMultiCapabilityButton = findStaticButton(
      renderProviderAccountsSection({
        accounts: [],
        accountInputs: {},
        newAccount: {
          ...form,
          capabilitiesText: "chat, image",
          testCapability: ""
        }
      }),
      "Test connection"
    );
    expect(unselectedMultiCapabilityButton.disabled).toBe(true);
  });

  it("keeps single capabilities automatic and enables selected multi-capability tests", () => {
    const cases: Array<[string, ProviderAccountFormState["testCapability"]]> = [
      ["chat", ""],
      ["image", ""],
      ["chat, image", "chat"],
      ["chat, image", "image"]
    ];

    for (const [capabilitiesText, testCapability] of cases) {
      const button = findStaticButton(
        renderProviderAccountsSection({
          accounts: [],
          accountInputs: {},
          newAccount: { ...form, capabilitiesText, testCapability }
        }),
        "Test connection"
      );
      expect(button.disabled, `${capabilitiesText} / ${testCapability || "auto"}`).toBe(
        false
      );
    }
  });

  it("defaults a provider form with only image capability to image testing", () => {
    const imageForm = providerAccountToForm({
      ...account,
      capabilities: ["image"],
      configJson: { testModel: "image-model" }
    });

    expect(imageForm.testCapability).toBe("image");
  });

  it("clears an inherited single-capability choice when capabilities become multi-capability", async () => {
    const onNewAccountChange = vi.fn();
    const initialForm = {
      ...form,
      baseUrl: "https://provider.example/v1",
      capabilitiesText: "chat",
      testCapability: "chat" as const
    };
    const host = await mountProviderAccountsSection({
      accounts: [],
      accountInputs: {},
      newAccount: initialForm,
      onNewAccountChange
    });
    const capabilitiesInput = Array.from(host.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Capabilities"))
      ?.querySelector("input");

    expect(capabilitiesInput).toBeTruthy();
    if (!capabilitiesInput) throw new Error("missing capabilities input");

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(capabilitiesInput, "chat, image");
      capabilitiesInput.dispatchEvent(new Event("input", { bubbles: true }));
      capabilitiesInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const changedForm = onNewAccountChange.mock.calls.at(-1)?.[0] as
      | ProviderAccountFormState
      | undefined;
    expect(changedForm).toMatchObject({
      capabilitiesText: "chat, image",
      testCapability: ""
    });
    const payload = parseProviderAccountTestPayload(changedForm ?? initialForm);
    expect(payload).not.toBeNull();
    expect(payload).not.toHaveProperty("testCapability");
  });

  it("ignores a deferred provider completion after editing the tested account", async () => {
    const deferred = createDeferred<Response>();
    const fetchImpl = await mountAdminPageForProviderTest(deferred.promise);

    await clickButton("Test connection");
    expect(
      fetchImpl.mock.calls.filter((call) =>
        String(call[0]).includes("/admin/provider-accounts/test")
      )
    ).toHaveLength(1);

    await clickButton("Edit account");
    const testModelInput = Array.from(
      interactionHost?.querySelectorAll("input") ?? []
    ).find(
      (input): input is HTMLInputElement =>
        input.value === "claude-3-5-haiku-latest"
    );
    expect(testModelInput).toBeTruthy();
    if (!testModelInput) throw new Error("missing provider test model input");

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(testModelInput, "edited-provider-model");
      testModelInput.dispatchEvent(new Event("input", { bubbles: true }));
      testModelInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      deferred.resolve(
        adminJsonResponse({ ok: true, message: "stale provider result" })
      );
      await Promise.resolve();
    });
    await flushAdminPage();

    expect(interactionHost?.textContent).not.toContain("stale provider result");
    expect(interactionHost?.textContent).not.toContain(
      "Connection test succeeded"
    );
  });

  it("treats an HTTP 200 provider response without ok=true as a failure", async () => {
    await mountAdminPageForProviderTest(adminJsonResponse({}));

    await clickButton("Test connection");
    await flushAdminPage();

    expect(interactionHost?.textContent).toContain("Test failed");
    expect(interactionHost?.textContent).not.toContain(
      "Connection test succeeded"
    );
  });

  it("omits write-only credentials from a saved-account PATCH when inputs stay blank", async () => {
    const fetchImpl = await mountAdminPageForProviderTest(adminJsonResponse({}));

    await clickButton("Edit account");
    const saveButton = findDrawerButton("Save");
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });
    await flushAdminPage();

    const patchCalls = fetchImpl.mock.calls.filter(
      (call) =>
        String(call[0]).includes("/admin/provider-accounts/") &&
        (call[1] as RequestInit | undefined)?.method === "PATCH"
    );
    expect(patchCalls).toHaveLength(1);
    const patchBody = JSON.parse(
      String((patchCalls[0]?.[1] as RequestInit | undefined)?.body)
    ) as Record<string, unknown>;
    expect(patchBody).not.toHaveProperty("apiKey");
    expect(patchBody).not.toHaveProperty("headersJson");
    expect(patchBody.capabilities).toEqual(["chat", "image"]);
  });

  it("preserves an ANTHROPIC account type when an unrelated field is edited", async () => {
    const anthropicAccount: AiProviderAccountSummary = {
      ...account,
      providerType: "ANTHROPIC",
      configJson: null
    };
    const fetchImpl = await mountAdminPageForProviderTest(
      adminJsonResponse({}),
      anthropicAccount
    );

    await clickButton("Edit account");
    const nameInput = findDrawerInput("Account name");
    expect(nameInput).toBeTruthy();
    if (!nameInput) throw new Error("missing account name input");
    await setInputValue(nameInput, "Edited Anthropic account");

    const saveButton = findDrawerButton("Save");
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });
    await flushAdminPage();

    const patchCalls = fetchImpl.mock.calls.filter(
      (call) =>
        String(call[0]).includes(`/admin/provider-accounts/${anthropicAccount.id}`) &&
        (call[1] as RequestInit | undefined)?.method === "PATCH"
    );
    expect(patchCalls).toHaveLength(1);
    const patchBody = JSON.parse(
      String((patchCalls[0]?.[1] as RequestInit | undefined)?.body)
    ) as Record<string, unknown>;
    expect(patchBody.name).toBe("Edited Anthropic account");
    expect(patchBody.providerType).toBe("ANTHROPIC");
  });

  it("uses an unsaved replacement key only for Test until Save persists it", async () => {
    const fetchImpl = await mountAdminPageForProviderTest(
      adminJsonResponse({
        ok: true,
        message: "Connection test succeeded",
        capability: "chat"
      })
    );

    await clickButton("Edit account");
    const apiKeyInput = findDrawerInput("API key");
    expect(apiKeyInput).toBeTruthy();
    if (!apiKeyInput) throw new Error("missing API key input");

    await setInputValue(apiKeyInput, "new-secret");
    const capabilitySelect = interactionHost?.querySelector<HTMLSelectElement>(
      'aside select[aria-label="测试能力 / Test capability"]'
    );
    expect(capabilitySelect).toBeTruthy();
    if (!capabilitySelect) throw new Error("missing provider test capability selector");
    await setSelectValue(capabilitySelect, "chat");
    expect(interactionHost?.textContent).toContain(
      "A new API key is entered. Test uses it for this test only; Test does not save it. Save to replace the saved key."
    );

    const testButton = findDrawerButton("Test connection");
    expect(testButton).toBeTruthy();
    await act(async () => {
      testButton?.click();
      await Promise.resolve();
    });
    await flushAdminPage();

    const testCalls = fetchImpl.mock.calls.filter(
      (call) => String(call[0]).includes("/admin/provider-accounts/test")
    );
    expect(testCalls).toHaveLength(1);
    const testBody = JSON.parse(
      String((testCalls[0]?.[1] as RequestInit | undefined)?.body)
    ) as Record<string, unknown>;
    expect(testBody.apiKey).toBe("new-secret");
    expect(
      fetchImpl.mock.calls.filter(
        (call) =>
          String(call[0]).includes("/admin/provider-accounts/") &&
          (call[1] as RequestInit | undefined)?.method === "PATCH"
      )
    ).toHaveLength(0);
    expect(interactionHost?.textContent).toContain("Connection test succeeded");

    await setInputValue(apiKeyInput, "   new-secret   ");
    const saveButton = findDrawerButton("Save");
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });
    await flushAdminPage();

    const patchCalls = fetchImpl.mock.calls.filter(
      (call) =>
        String(call[0]).includes("/admin/provider-accounts/") &&
        (call[1] as RequestInit | undefined)?.method === "PATCH"
    );
    expect(patchCalls).toHaveLength(1);
    expect(
      JSON.parse(String((patchCalls[0]?.[1] as RequestInit | undefined)?.body))
    ).toMatchObject({ apiKey: "new-secret" });
  });

  it("sends valid capabilities in a create payload", async () => {
    const fetchImpl = await mountAdminPageForProviderTest(adminJsonResponse({}));

    await clickButton("Create account");
    const nameInput = findDrawerInput("Account name");
    const baseUrlInput = findDrawerInput("Base URL");
    expect(nameInput).toBeTruthy();
    expect(baseUrlInput).toBeTruthy();
    if (!nameInput || !baseUrlInput) throw new Error("missing create fields");
    await setInputValue(nameInput, "Created provider");
    await setInputValue(baseUrlInput, "https://provider.example/v1");

    const createButton = findDrawerButton("Create account");
    expect(createButton).toBeTruthy();
    await act(async () => {
      createButton?.click();
      await Promise.resolve();
    });
    await flushAdminPage();

    const postCalls = fetchImpl.mock.calls.filter(
      (call) =>
        String(call[0]) === "/api/admin/provider-accounts" &&
        (call[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(postCalls).toHaveLength(1);
    expect(
      JSON.parse(String((postCalls[0]?.[1] as RequestInit | undefined)?.body))
    ).toMatchObject({
      name: "Created provider",
      baseUrl: "https://provider.example/v1",
      capabilities: ["chat"]
    });
  });

  it("does not POST or PATCH when capabilities contain an unsupported token", async () => {
    const createFetch = await mountAdminPageForProviderTest(adminJsonResponse({}));

    await clickButton("Create account");
    const createCapabilitiesInput = findDrawerInput("Capabilities");
    expect(createCapabilitiesInput).toBeTruthy();
    if (!createCapabilitiesInput) throw new Error("missing create capabilities input");
    await setInputValue(createCapabilitiesInput, "chat,foo");
    expect(interactionHost?.textContent).toContain("Unsupported capability: foo");

    const createButton = findDrawerButton("Create account");
    expect(createButton).toBeTruthy();
    await act(async () => {
      createButton?.click();
      await Promise.resolve();
    });
    await flushAdminPage();

    expect(
      createFetch.mock.calls.filter(
        (call) =>
          String(call[0]) === "/api/admin/provider-accounts" &&
          (call[1] as RequestInit | undefined)?.method === "POST"
      )
    ).toHaveLength(0);

    await act(async () => interactionRoot?.unmount());
    interactionRoot = null;

    const updateFetch = await mountAdminPageForProviderTest(adminJsonResponse({}));
    await clickButton("Edit account");
    const updateCapabilitiesInput = findDrawerInput("Capabilities");
    expect(updateCapabilitiesInput).toBeTruthy();
    if (!updateCapabilitiesInput) throw new Error("missing update capabilities input");
    await setInputValue(updateCapabilitiesInput, "chat,foo");

    const saveButton = findDrawerButton("Save");
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });
    await flushAdminPage();

    expect(
      updateFetch.mock.calls.filter(
        (call) =>
          String(call[0]).includes("/admin/provider-accounts/") &&
          (call[1] as RequestInit | undefined)?.method === "PATCH"
      )
    ).toHaveLength(0);
  });

  it("defaults Anthropic accounts to Anthropic Messages request format", () => {
    const anthropicForm = providerAccountToForm({
      ...account,
      providerType: "ANTHROPIC",
      configJson: null
    });

    expect(anthropicForm.requestFormat).toBe("anthropic");
    expect(anthropicForm.anthropicAuthMode).toBe("x-api-key");
  });

  it("defaults SUB2API Anthropic Messages accounts to both auth headers", () => {
    const sub2apiForm = providerAccountToForm({
      ...account,
      providerType: "SUB2API",
      configJson: { requestFormat: "anthropic" }
    });

    expect(sub2apiForm.requestFormat).toBe("anthropic");
    expect(sub2apiForm.anthropicAuthMode).toBe("both");
  });

  it("reads messagesPath from provider account config into the form", () => {
    expect(providerAccountToForm(account).messagesPath).toBe("/v1/messages");
  });

  it("reads the nested moderation declaration without touching the chat format", () => {
    const moderationForm = providerAccountToForm({
      ...account,
      configJson: {
        requestFormat: "anthropic",
        moderation: {
          requestFormat: "openai-moderation",
          upstreamModel: "omni-moderation-latest",
          endpointPath: "/v1/moderations",
          supportsText: true,
          supportsImage: false
        }
      }
    });

    expect(moderationForm.moderationEnabled).toBe(true);
    expect(moderationForm.moderationSupportsImage).toBe(false);
    expect(moderationForm.requestFormat).toBe("anthropic");
  });

  it("safely reads an unknown moderation declaration as disabled with defaults", () => {
    const moderationForm = providerAccountToForm({
      ...account,
      configJson: {
        requestFormat: "anthropic",
        moderation: {
          requestFormat: "future-moderation-v2",
          futureFlag: true
        }
      }
    });

    expect(moderationForm.moderationEnabled).toBe(false);
    expect(moderationForm.moderationUpstreamModel).toBe("omni-moderation-latest");
    expect(moderationForm.moderationEndpointPath).toBe("/v1/moderations");
    expect(moderationForm.moderationSupportsText).toBe(true);
    expect(moderationForm.moderationSupportsImage).toBe(true);
    expect(moderationForm.requestFormat).toBe("anthropic");
  });

  it("merges moderation into configJson.moderation and preserves unknown fields", () => {
    const merged = mergeProviderAccountConfigJson(
      {
        ...form,
        requestFormat: "anthropic",
        anthropicAuthMode: "both",
        moderationEnabled: true,
        moderationRequestFormat: "openai-moderation",
        moderationUpstreamModel: "omni-moderation-latest",
        moderationEndpointPath: "/v1/moderations",
        moderationSupportsText: true,
        moderationSupportsImage: true,
        configJson: ""
      },
      { region: "global", requestFormat: "anthropic", moderation: { futureFlag: true } }
    );

    expect(merged).toMatchObject({
      region: "global",
      requestFormat: "anthropic",
      moderation: {
        requestFormat: "openai-moderation",
        futureFlag: true
      }
    });
  });

  it("keeps unknown moderation in the PATCH config when ordinary drawer fields change", () => {
    const unknownConfig = {
      region: "global",
      requestFormat: "anthropic",
      anthropicAuthMode: "both",
      messagesPath: "/v1/messages",
      moderation: {
        requestFormat: "future-moderation-v2",
        futureFlag: true
      }
    };
    const drawerForm = providerAccountToForm({
      ...account,
      configJson: unknownConfig,
      notes: "before"
    });
    const editedForm = {
      ...drawerForm,
      notes: "after",
      timeoutMs: "30000"
    };
    const savedConfig = mergeProviderAccountConfigJson(
      editedForm,
      JSON.parse(editedForm.configJson) as Record<string, unknown>
    );

    expect(editedForm.apiKey).toBe("");
    expect(editedForm.notes).toBe("after");
    expect(editedForm.timeoutMs).toBe("30000");
    expect(savedConfig).toEqual(unknownConfig);
    expect(savedConfig?.requestFormat).toBe("anthropic");
    expect(savedConfig?.moderation).toEqual(unknownConfig.moderation);
  });

  it("renders the moderation declaration form in the provider drawer", () => {
    const html = renderProviderAccountsSection({
      accounts: [],
      accountInputs: {},
      newAccount: {
        ...form,
        moderationEnabled: true,
        moderationRequestFormat: "openai-moderation",
        moderationUpstreamModel: "omni-moderation-latest",
        moderationEndpointPath: "/v1/moderations",
        moderationSupportsText: true,
        moderationSupportsImage: true
      }
    });

    expect(html).toContain("Content moderation compatibility");
    expect(html).toContain("Declare moderation support");
    expect(html).toContain("openai-moderation");
    expect(html).toContain("Supports text moderation");
    expect(html).toContain("Supports image moderation");
  });

  it("renders saved account test connection controls and loading state", () => {
    const html = renderProviderAccountsSection({
      testingNewAccount: true,
      testingAccountId: account.id
    });

    expect(html).toContain("Testing...");
    expect(html).toContain("disabled");
  });

  it("renders provider account test status inline without leaking secrets", () => {
    const html = renderProviderAccountsSection({
      testResults: {
        [account.id]: {
          status: "error",
          message: "Connection test failed. Check the Base URL, API key, model name, or provider format.",
          requestFormat: "anthropic",
          authMode: "both",
          endpointPath: "/v1/messages",
          statusCode: 401,
          model: "deepseek-v4-flash",
          latencyMs: 123
        }
      }
    });

    expect(html).toContain("Test failed");
    expect(html).toContain(
      "Connection test failed. Check the Base URL, API key, model name, or provider format."
    );
    expect(html).not.toContain("secret-token");
    expect(html).not.toContain("api_key=hidden");
    expect(html).not.toContain("sk-ant-test");
  });

  it("shows unknown moderation references and blocks disabling a declared account", async () => {
    const declaredAccount = {
      ...account,
      configJson: {
        ...account.configJson,
        moderation: {
          requestFormat: "openai-moderation",
          upstreamModel: "omni-moderation-latest",
          endpointPath: "/v1/moderations",
          supportsText: true,
          supportsImage: true
        }
      }
    };
    const html = renderProviderAccountsSection({
      accounts: [],
      accountInputs: {},
      newAccount: {
        ...form,
        moderationEnabled: true,
        moderationRequestFormat: "openai-moderation",
        moderationUpstreamModel: "omni-moderation-latest",
        moderationEndpointPath: "/v1/moderations",
        moderationSupportsText: true,
        moderationSupportsImage: true
      }
    });

    expect(html).toContain("Declare moderation support");
    expect(html).not.toContain("Content Safety settings have not loaded");

    const host = await mountProviderAccountsSection({
      accounts: [declaredAccount],
      accountInputs: { [declaredAccount.id]: providerAccountToForm(declaredAccount) },
      moderationReferenceDataAvailable: false
    });
    const editButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Edit account")
    );
    await act(async () => editButton?.click());
    expect(host.textContent).toContain("Content Safety settings have not loaded");
    const moderationToggle = host.querySelector<HTMLInputElement>(
      'input[aria-label="Declare moderation support"]'
    );
    expect(moderationToggle?.disabled).toBe(true);
  });

  it("tests only the exact routeId and renders safe route metadata without image output", async () => {
    if (!interactionHost) throw new Error("missing interaction host");
    const route: AiModelRouteSummary = {
      id: "route_test_1",
      modelId: "model_route_test",
      providerId: account.id,
      providerName: account.name,
      upstreamModel: "stored-upstream-model",
      priority: 1,
      enabled: true,
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:00:00.000Z"
    };
    const model: AdminAiModelSummary = {
      id: "model_route_test",
      name: "Route Test Model",
      slug: "route-test-model",
      provider: "OPENAI_COMPATIBLE",
      capability: "chat",
      modelId: "canonical-route-model",
      group: "advanced",
      tags: ["chat"],
      enabled: true,
      maxReferenceImages: 1,
      creditCost: 1,
      allowGuest: false,
      sortOrder: 1,
      isRecommended: false,
      routes: [route]
    };
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          success: true,
          message: "安全线路测试成功",
          capability: "chat",
          requestFormat: "openai-compatible",
          upstreamModel: "stored-upstream-model",
          latencyMs: 12,
          endpointPath: "/chat/completions",
          statusCode: 200,
          routeEnabled: true,
          providerEnabled: true,
          imageBase64: "data:image/png;base64,SECRET",
          imageUrl: "https://secret-image.example/result.png"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchImpl);
    window.localStorage.setItem("ai-aggregate-token", "admin-token");

    interactionRoot = createRoot(interactionHost);
    const routeForm = {
      providerAccountId: account.id,
      upstreamModel: route.upstreamModel,
      priority: "1",
      enabled: true
    };
    const renderRoute = (nextRoute: AiModelRouteSummary = route) => (
      <I18nContext.Provider
        value={{
          locale: "en-US",
          setLocale: vi.fn(),
          t: createTranslator("en-US")
        }}
      >
        <AdminModelRoutesEditor
          model={model}
          routes={[nextRoute]}
          providerAccounts={[account]}
          routeForm={routeForm}
          savingModelRouteId={null}
          inputClass={inputClass}
          checkboxClass={checkboxClass}
          primaryButtonClass={primaryButtonClass}
          toggleInlineClass={toggleInlineClass}
          onRouteFormChange={vi.fn()}
          onCreateRoute={vi.fn()}
          onUpdateRoute={vi.fn()}
          onDisableRoute={vi.fn()}
        />
      </I18nContext.Provider>
    );

    await act(async () => {
      interactionRoot?.render(renderRoute());
      await Promise.resolve();
    });
    const testButton = Array.from(interactionHost.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("测试此线路")
    );
    expect(testButton).toBeTruthy();

    await act(async () => {
      testButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/admin/model-routes/route_test_1/test",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer admin-token" }
      })
    );
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty("body");
    expect(interactionHost.textContent).toContain("stored-upstream-model");
    expect(interactionHost.textContent).toContain("/chat/completions");
    expect(interactionHost.textContent).not.toContain("data:image/png");
    expect(interactionHost.textContent).not.toContain("secret-image.example");

    await act(async () => {
      interactionRoot?.render(
        renderRoute({
          ...route,
          enabled: false,
          updatedAt: "2026-08-08T00:01:00.000Z"
        })
      );
      await Promise.resolve();
    });
    expect(interactionHost.textContent).not.toContain("安全线路测试成功");
  });

  it("ignores deferred route completions after draft edits and refresh, and serializes route tests", async () => {
    if (!interactionHost) throw new Error("missing interaction host");
    const routeA: AiModelRouteSummary = {
      id: "route_test_a",
      modelId: "model_route_test",
      providerId: account.id,
      providerName: account.name,
      upstreamModel: "route-a-model",
      priority: 1,
      enabled: true,
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:00:00.000Z"
    };
    const routeB: AiModelRouteSummary = {
      ...routeA,
      id: "route_test_b",
      upstreamModel: "route-b-model",
      priority: 2
    };
    const model: AdminAiModelSummary = {
      id: "model_route_test",
      name: "Route Test Model",
      slug: "route-test-model",
      provider: "OPENAI_COMPATIBLE",
      capability: "chat",
      modelId: "canonical-route-model",
      group: "advanced",
      tags: ["chat"],
      enabled: true,
      maxReferenceImages: 1,
      creditCost: 1,
      allowGuest: false,
      sortOrder: 1,
      isRecommended: false,
      routes: [routeA, routeB]
    };
    const pending: Array<ReturnType<typeof createDeferred<Response>>> = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const deferred = createDeferred<Response>();
      pending.push(deferred);
      return deferred.promise;
    });
    vi.stubGlobal("fetch", fetchImpl);
    window.localStorage.setItem("ai-aggregate-token", "admin-token");
    const routeForm = {
      providerAccountId: account.id,
      upstreamModel: "new-route-model",
      priority: "1",
      enabled: true
    };
    const onUpdateRoute = vi.fn();
    const onDisableRoute = vi.fn();
    const renderRoutes = (routes: AiModelRouteSummary[]) => (
      <I18nContext.Provider
        value={{
          locale: "en-US",
          setLocale: vi.fn(),
          t: createTranslator("en-US")
        }}
      >
        <AdminModelRoutesEditor
          model={model}
          routes={routes}
          providerAccounts={[account]}
          routeForm={routeForm}
          savingModelRouteId={null}
          inputClass={inputClass}
          checkboxClass={checkboxClass}
          primaryButtonClass={primaryButtonClass}
          toggleInlineClass={toggleInlineClass}
          onRouteFormChange={vi.fn()}
          onCreateRoute={vi.fn()}
          onUpdateRoute={onUpdateRoute}
          onDisableRoute={onDisableRoute}
        />
      </I18nContext.Provider>
    );
    const routeRow = (routeId: string) =>
      Array.from(
        interactionHost?.querySelectorAll<HTMLElement>("[data-admin-model-route]") ??
          []
      ).find((row) =>
        Array.from(row.querySelectorAll("input")).some((input) =>
          input.getAttribute("aria-label")?.endsWith(routeId)
        )
      ) ?? null;
    const routeTestButton = (row: HTMLElement | null) =>
      Array.from(row?.querySelectorAll("button") ?? []).find((button) =>
        button.textContent?.includes("测试此线路")
      ) ?? null;

    interactionRoot = createRoot(interactionHost);
    await act(async () => {
      interactionRoot?.render(renderRoutes([routeA, routeB]));
      await Promise.resolve();
    });

    const rowA = routeRow(routeA.id);
    const rowB = routeRow(routeB.id);
    const testA = routeTestButton(rowA);
    const testB = routeTestButton(rowB);
    expect(testA).toBeTruthy();
    expect(testB).toBeTruthy();

    await act(async () => {
      testA?.click();
      await Promise.resolve();
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(testB?.disabled).toBe(true);

    await act(async () => {
      testB?.click();
      await Promise.resolve();
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const upstreamInput = rowA?.querySelectorAll<HTMLInputElement>("input")[0];
    expect(upstreamInput).toBeTruthy();
    if (!upstreamInput) throw new Error("missing route draft input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(upstreamInput, "edited-route-a-model");
      upstreamInput.dispatchEvent(new Event("input", { bubbles: true }));
      upstreamInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(testB?.disabled).toBe(true);
    await act(async () => {
      testB?.click();
      await Promise.resolve();
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    pending[0]?.resolve(
      new Response(JSON.stringify({ success: true, message: "stale route result" }), {
        status: 200
      })
    );
    await act(async () => {
      await pending[0]?.promise;
      await Promise.resolve();
    });
    expect(interactionHost.textContent).not.toContain("stale route result");

    await act(async () => {
      routeTestButton(routeRow(routeA.id))?.click();
      await Promise.resolve();
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await act(async () => {
      interactionRoot?.render(
        renderRoutes([
          { ...routeA, upstreamModel: "refreshed-route-a-model" },
          routeB
        ])
      );
      await Promise.resolve();
    });
    pending[1]?.resolve(
      new Response(JSON.stringify({ success: true, message: "stale refresh result" }), {
        status: 200
      })
    );
    await act(async () => {
      await pending[1]?.promise;
      await Promise.resolve();
    });
    expect(interactionHost.textContent).not.toContain("stale refresh result");
  });

  it("ignores deferred route completions after route update and disable", async () => {
    if (!interactionHost) throw new Error("missing interaction host");
    const route: AiModelRouteSummary = {
      id: "route_test_mutation",
      modelId: "model_route_test",
      providerId: account.id,
      providerName: account.name,
      upstreamModel: "stored-route-model",
      priority: 1,
      enabled: true,
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:00:00.000Z"
    };
    const model: AdminAiModelSummary = {
      id: "model_route_test",
      name: "Route Test Model",
      slug: "route-test-model",
      provider: "OPENAI_COMPATIBLE",
      capability: "chat",
      modelId: "canonical-route-model",
      group: "advanced",
      tags: ["chat"],
      enabled: true,
      maxReferenceImages: 1,
      creditCost: 1,
      allowGuest: false,
      sortOrder: 1,
      isRecommended: false,
      routes: [route]
    };
    const pending: Array<ReturnType<typeof createDeferred<Response>>> = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const deferred = createDeferred<Response>();
      pending.push(deferred);
      return deferred.promise;
    });
    const onUpdateRoute = vi.fn();
    const onDisableRoute = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    window.localStorage.setItem("ai-aggregate-token", "admin-token");
    const renderRoute = () => (
      <I18nContext.Provider
        value={{
          locale: "en-US",
          setLocale: vi.fn(),
          t: createTranslator("en-US")
        }}
      >
        <AdminModelRoutesEditor
          model={model}
          routes={[route]}
          providerAccounts={[account]}
          routeForm={{
            providerAccountId: account.id,
            upstreamModel: "new-route-model",
            priority: "1",
            enabled: true
          }}
          savingModelRouteId={null}
          inputClass={inputClass}
          checkboxClass={checkboxClass}
          primaryButtonClass={primaryButtonClass}
          toggleInlineClass={toggleInlineClass}
          onRouteFormChange={vi.fn()}
          onCreateRoute={vi.fn()}
          onUpdateRoute={onUpdateRoute}
          onDisableRoute={onDisableRoute}
        />
      </I18nContext.Provider>
    );
    interactionRoot = createRoot(interactionHost);
    await act(async () => {
      interactionRoot?.render(renderRoute());
      await Promise.resolve();
    });
    const row = () => interactionHost?.querySelector<HTMLElement>("[data-admin-model-route]") ?? null;
    const button = (label: string) =>
      Array.from(row()?.querySelectorAll("button") ?? []).find((item) =>
        item.textContent?.includes(label)
      ) ?? null;

    await act(async () => {
      button("测试此线路")?.click();
      await Promise.resolve();
    });
    await act(async () => button("Save route")?.click());
    expect(onUpdateRoute).toHaveBeenCalledTimes(1);
    expect(onUpdateRoute).toHaveBeenCalledWith(model, route, {
      providerId: account.id,
      upstreamModel: route.upstreamModel,
      priority: route.priority,
      enabled: route.enabled
    });
    pending[0]?.resolve(
      new Response(JSON.stringify({ success: true, message: "stale update result" }), {
        status: 200
      })
    );
    await act(async () => {
      await pending[0]?.promise;
      await Promise.resolve();
    });
    expect(interactionHost.textContent).not.toContain("stale update result");

    await act(async () => {
      button("测试此线路")?.click();
      await Promise.resolve();
    });
    await act(async () => button("Disable route")?.click());
    expect(onDisableRoute).toHaveBeenCalledTimes(1);
    pending[1]?.resolve(
      new Response(JSON.stringify({ success: true, message: "stale disable result" }), {
        status: 200
      })
    );
    await act(async () => {
      await pending[1]?.promise;
      await Promise.resolve();
    });
    expect(interactionHost.textContent).not.toContain("stale disable result");
  });

  it("treats an HTTP 200 route response without success=true as an error", async () => {
    if (!interactionHost) throw new Error("missing interaction host");
    const route: AiModelRouteSummary = {
      id: "route_test_malformed",
      modelId: "model_route_test",
      providerId: account.id,
      providerName: account.name,
      upstreamModel: "malformed-route-model",
      priority: 1,
      enabled: true,
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:00:00.000Z"
    };
    const model: AdminAiModelSummary = {
      id: "model_route_test",
      name: "Route Test Model",
      slug: "route-test-model",
      provider: "OPENAI_COMPATIBLE",
      capability: "chat",
      modelId: "canonical-route-model",
      group: "advanced",
      tags: ["chat"],
      enabled: true,
      maxReferenceImages: 1,
      creditCost: 1,
      allowGuest: false,
      sortOrder: 1,
      isRecommended: false,
      routes: [route]
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }))
    );
    window.localStorage.setItem("ai-aggregate-token", "admin-token");
    interactionRoot = createRoot(interactionHost);
    await act(async () => {
      interactionRoot?.render(
        <I18nContext.Provider
          value={{
            locale: "en-US",
            setLocale: vi.fn(),
            t: createTranslator("en-US")
          }}
        >
          <AdminModelRoutesEditor
            model={model}
            routes={[route]}
            providerAccounts={[account]}
            routeForm={{
              providerAccountId: account.id,
              upstreamModel: "new-route-model",
              priority: "1",
              enabled: true
            }}
            savingModelRouteId={null}
            inputClass={inputClass}
            checkboxClass={checkboxClass}
            primaryButtonClass={primaryButtonClass}
            toggleInlineClass={toggleInlineClass}
            onRouteFormChange={vi.fn()}
            onCreateRoute={vi.fn()}
            onUpdateRoute={vi.fn()}
            onDisableRoute={vi.fn()}
          />
        </I18nContext.Provider>
      );
      await Promise.resolve();
    });
    const testButton = Array.from(interactionHost.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("测试此线路")
    );
    await act(async () => {
      testButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(interactionHost.textContent).toContain("线路测试失败");
    expect(interactionHost.textContent).not.toContain("线路测试成功");
  });

  it("closes the drawer after one successful provider mutation", async () => {
    const onUpdateAccount = vi.fn().mockResolvedValue(true);
    const host = await mountProviderAccountsSection({ onUpdateAccount });
    const editButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Edit account")
    );
    expect(editButton).toBeTruthy();

    await act(async () => editButton?.click());
    const saveButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.trim() === "Save"
    );
    expect(saveButton).toBeTruthy();

    await act(async () => saveButton?.click());
    expect(onUpdateAccount).toHaveBeenCalledTimes(1);
    expect(host.querySelector("aside")).toBeNull();
  });

  it("renders provider account selection for model binding", () => {
    const html = renderWithI18n(
      <AdminModelProviderAccountSelect
        accounts={[account]}
        ariaLabel="Provider account test-model"
        className={inputClass}
        value={account.id}
        onChange={vi.fn()}
      />
    );

    expect(html).toContain("No provider account");
    expect(html).toContain("OpenRouter backup (OPENAI_COMPATIBLE)");
    expect(html).toContain(`value="${account.id}"`);
  });
});
