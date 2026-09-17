// @vitest-environment jsdom

import React, { act } from "react";
import type {
  AdminAiModelSummary,
  AiProviderAccountSummary
} from "@ai-aggregate/shared";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authTokenKey, authUserKey } from "../../components/auth-state";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import { AdminAuthProvider } from "./admin-auth-context";
import AdminPageClient from "./admin-page-client";
import {
  AdminPageHeader,
} from "./admin-layout";
import {
  adminNavigationGroups,
  adminSections,
  adminSettingsAreas,
  defaultAdminSettingsArea,
  defaultAdminSection,
  getAdminNavigationGroup,
  getAdminSectionDefinition,
  getAdminSectionFromPathname,
  getAdminSectionFromRouteSegment,
  getAdminSectionHref,
  getAdminSettingsAreaFromPathname,
  getAdminSettingsAreaFromRouteSegment,
  getAdminSidebarSection
} from "./admin-navigation";
import { AdminSettingsAreaNavigation } from "./admin-sections";
import { AdminSidebar } from "./admin-sidebar";
import {
  AdminModelsSection,
  type ModelFormState
} from "./admin-models-section";
import type { ModelRouteFormState } from "./admin-model-detail-drawer";
import AdminRootPage from "./page";
import AdminSectionPage from "./[section]/page";
import AdminSettingsSubsectionPage from "./settings/[subsection]/page";

const navigationMocks = vi.hoisted(() => ({
  pathname: "/admin/overview",
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  router: { replace: vi.fn() }
}));

vi.mock("next/navigation", () => ({
  notFound: navigationMocks.notFound,
  redirect: navigationMocks.redirect,
  usePathname: () => navigationMocks.pathname,
  useRouter: () => navigationMocks.router
}));

vi.mock("next/link", async () => {
  const ReactModule = await import("react");
  return {
    default: ({
      children,
      onClick,
      ...props
    }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
      ReactModule.createElement(
        "a",
        {
          ...props,
          onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
            event.preventDefault();
            onClick?.(event);
          }
        },
        children
      )
  };
});

const canonicalSections = [
  ["overview", "/admin/overview", "overview"],
  ["users", "/admin/users", "users"],
  ["feedback", "/admin/feedback", "feedback"],
  ["models", "/admin/models", "models"],
  ["providerAccounts", "/admin/provider-accounts", "provider-accounts"],
  ["moderation", "/admin/moderation", "moderation"],
  ["plans", "/admin/plans", "plans"],
  ["orders", "/admin/orders", "orders"],
  ["payments", "/admin/payments", "payments"],
  [
    "storageSubscriptions",
    "/admin/storage-subscriptions",
    "storage-subscriptions"
  ],
  ["settings", "/admin/settings", "settings"],
  ["links", "/admin/links", "links"],
  ["contact", "/admin/contact", "contact"],
  ["operations", "/admin/operations", "operations"],
  ["usage", "/admin/usage", "usage"],
  ["audit", "/admin/audit", "audit"]
] as const;

const canonicalSettingsAreas = [
  ["brand", "/admin/settings", null],
  ["workspace", "/admin/settings/workspace", "workspace"],
  ["access", "/admin/settings/access", "access"],
  ["benefits", "/admin/settings/benefits", "benefits"]
] as const;

const i18nValue = {
  locale: "en-US" as const,
  setLocale: vi.fn(),
  t: createTranslator("en-US")
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  host?.remove();
  root = null;
  host = null;
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  navigationMocks.pathname = "/admin/overview";
});

function renderSidebar(pathname: string) {
  navigationMocks.pathname = pathname;
  return renderToStaticMarkup(
    <I18nContext.Provider value={i18nValue}>
      <AdminSidebar />
    </I18nContext.Provider>
  );
}

function renderPageIdentity(
  section: (typeof adminSections)[number],
  locale: "en-US" | "zh-CN"
) {
  const t = createTranslator(locale);
  const group = section.sidebar?.groupId
    ? getAdminNavigationGroup(section.sidebar.groupId)
    : null;

  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{ locale, setLocale: vi.fn(), t }}
    >
      <AdminPageHeader
        eyebrow={group ? t(group.labelKey) : t("admin.title")}
        title={t(section.labelKey)}
        description={t(section.descriptionKey)}
      />
    </I18nContext.Provider>
  );
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

const createdModelFixture: AdminAiModelSummary = {
  id: "model_created",
  name: "created-model",
  displayName: "Created Model",
  slug: "created-model",
  provider: "OPENAI_COMPATIBLE",
  providerAccountId: "provider_account_1",
  capability: "chat",
  displaySurfaces: ["chat"],
  imageInvokeMode: "native-image",
  imageOutputParser: "native-image",
  modelId: "created-model-upstream",
  group: "chat",
  tags: [],
  shortDescription: "",
  enabled: true,
  maxReferenceImages: 1,
  creditCost: 1,
  allowGuest: false,
  sortOrder: 0,
  isRecommended: false,
  routes: []
};

const providerAccountFixture: AiProviderAccountSummary = {
  id: "provider_account_1",
  name: "Reusable Upstream",
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://provider.example/v1",
  capabilities: ["chat"],
  enabled: true,
  priority: 1,
  timeoutMs: 60000,
  configJson: null,
  notes: null,
  hasApiKey: true,
  hasCustomHeaders: false,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z"
};

const newModelFixture: ModelFormState = {
  name: "created-model",
  displayName: "Created Model",
  modelId: "created-model-upstream",
  provider: "OPENAI_COMPATIBLE",
  providerAccountId: providerAccountFixture.id,
  capability: "chat",
  displaySurfaces: ["chat"],
  imageInvokeMode: "native-image",
  imageOutputParser: "native-image",
  maxReferenceImages: "1",
  group: "chat",
  tagsText: "",
  shortDescription: "",
  isRecommended: false,
  enabled: true,
  allowGuest: false,
  creditCost: "1",
  sortOrder: "0",
  iconUrl: "",
  iconText: "",
  iconColor: ""
};

function ModelsCreateContinuationHarness({
  onCreateRequest,
  onCreateRoute
}: {
  onCreateRequest: () => Promise<AdminAiModelSummary>;
  onCreateRoute: (model: AdminAiModelSummary) => void;
}) {
  const [models, setModels] = React.useState<AdminAiModelSummary[]>([]);
  const [newModel, setNewModel] = React.useState(newModelFixture);
  const [modelInputs, setModelInputs] = React.useState<
    Record<string, ModelFormState>
  >({});
  const [modelRouteInputs, setModelRouteInputs] = React.useState<
    Record<string, ModelRouteFormState>
  >({});

  return (
    <AdminModelsSection
      checkboxClass="checkbox"
      creatingModel={false}
      emptyModelRouteForm={{
        providerAccountId: "",
        upstreamModel: "",
        priority: "1",
        enabled: true
      }}
      iconButtonClass="icon"
      inputClass="input"
      modelCapabilityOptions={["chat", "image", "video", "ppt"]}
      modelInputs={modelInputs}
      modelProviders={["OPENAI_COMPATIBLE"]}
      modelRouteInputs={modelRouteInputs}
      models={models}
      newModel={newModel}
      primaryButtonClass="primary"
      providerAccounts={[providerAccountFixture]}
      savingModelId={null}
      savingModelRouteId={null}
      toggleInlineClass="toggle"
      onCopyModelId={vi.fn()}
      onCreateModel={async () => {
        const createdModel = await onCreateRequest();
        setModels([createdModel]);
        setModelInputs({ [createdModel.id]: newModelFixture });
        setNewModel(newModelFixture);
        return createdModel;
      }}
      onCreateModelRoute={onCreateRoute}
      onDeleteModel={vi.fn()}
      onDisableModel={vi.fn()}
      onDisableModelRoute={vi.fn()}
      onModelInputsChange={setModelInputs}
      onModelRouteInputsChange={setModelRouteInputs}
      onNewModelChange={setNewModel}
      onUpdateModel={vi.fn()}
      onUpdateModelRoute={vi.fn()}
    />
  );
}

describe("Admin canonical navigation contract", () => {
  it("maps every AdminSectionId to its canonical path and back", () => {
    expect(adminSections).toHaveLength(canonicalSections.length);

    for (const [id, href, routeSegment] of canonicalSections) {
      expect(getAdminSectionHref(id)).toBe(href);
      expect(getAdminSectionFromPathname(href)).toBe(id);
      expect(getAdminSectionFromPathname(`${href}/`)).toBe(id);
      expect(getAdminSectionFromRouteSegment(routeSegment)).toBe(id);
    }
  });

  it("keeps localized page identity metadata in the central section registry", () => {
    const identitySections = [
      "overview",
      "models",
      "providerAccounts",
      "settings",
      "orders",
      "operations"
    ] as const;
    const t = createTranslator("en-US");
    const tZh = createTranslator("zh-CN");

    for (const sectionId of identitySections) {
      const section = getAdminSectionDefinition(sectionId);
      const html = renderPageIdentity(section, "en-US");

      expect(section.descriptionKey).toMatch(/^admin\.sectionDescription\./);
      expect(html).toContain(t(section.labelKey).replaceAll("&", "&amp;"));
      expect(html).toContain(t(section.descriptionKey));
      expect(tZh(section.descriptionKey)).not.toBe(section.descriptionKey);
      expect(html).toContain('data-admin-page-header="true"');
    }
  });

  it("renders route-specific desktop and mobile identity without header metric duplication", async () => {
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
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    const renderAdminPage = async (pathname: string) => {
      navigationMocks.pathname = pathname;
      await act(async () => {
        root?.render(
          <I18nContext.Provider value={i18nValue}>
            <AdminAuthProvider>
              <AdminPageClient />
            </AdminAuthProvider>
          </I18nContext.Provider>
        );
      });
      for (let index = 0; index < 10; index += 1) {
        await act(async () => {
          await Promise.resolve();
        });
      }
    };

    const identitySections = [
      "overview",
      "models",
      "providerAccounts",
      "settings",
      "orders",
      "operations"
    ] as const;
    const t = i18nValue.t;

    for (const sectionId of identitySections) {
      const section = getAdminSectionDefinition(sectionId);
      await renderAdminPage(section.href);

      const header = host.querySelector<HTMLElement>(
        '[data-admin-page-header="true"]'
      );
      expect(header?.querySelector("h1")?.textContent).toBe(t(section.labelKey));
      expect(header?.querySelector("p")?.textContent).toBe(
        t(section.descriptionKey)
      );
      expect(host.querySelector('[data-admin-overview-metrics="true"]')).toBeNull();
      expect(
        Boolean(host.querySelector('[data-admin-overview-dashboard="true"]'))
      ).toBe(sectionId === "overview");

      const mobileTitle = host.querySelector<HTMLElement>(
        '[data-admin-mobile-page-title="true"]'
      );
      expect(mobileTitle?.textContent).toBe(t(section.labelKey));
      const mobileGroup = host.querySelector<HTMLElement>(
        '[data-admin-mobile-page-group="true"]'
      );
      const expectedGroup = section.sidebar?.groupId
        ? getAdminNavigationGroup(section.sidebar.groupId)
        : null;
      expect(mobileGroup?.textContent).toBe(
        expectedGroup ? t(expectedGroup.labelKey) : t("admin.title")
      );
      expect(header?.textContent).not.toContain(t("admin.totalUsers"));
      expect(header?.textContent).not.toContain(t("admin.callsToday"));
      expect(header?.textContent).not.toContain(t("admin.pendingOrders"));
    }

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(
      true
    );
  });

  it("redirects /admin to the canonical Overview landing path", () => {
    expect(defaultAdminSection).toBe("overview");
    expect(() => AdminRootPage()).toThrow("NEXT_REDIRECT");
    expect(navigationMocks.redirect).toHaveBeenCalledWith("/admin/overview");
  });

  it("maps every Site and Product settings area to one canonical clean path", () => {
    expect(defaultAdminSettingsArea).toBe("brand");
    expect(adminSettingsAreas).toHaveLength(canonicalSettingsAreas.length);

    for (const [id, href, routeSegment] of canonicalSettingsAreas) {
      expect(getAdminSettingsAreaFromPathname(href)).toBe(id);
      expect(getAdminSettingsAreaFromPathname(`${href}/`)).toBe(id);
      expect(getAdminSectionFromPathname(href)).toBe("settings");
      if (routeSegment) {
        expect(getAdminSettingsAreaFromRouteSegment(routeSegment)).toBe(id);
      }
    }
  });

  it("fails closed for unknown and non-canonical Admin paths", async () => {
    expect(getAdminSectionFromPathname("/admin")).toBeNull();
    expect(getAdminSectionFromPathname("/admin/not-a-section")).toBeNull();
    expect(getAdminSectionFromPathname("/admin/models/model-1")).toBeNull();
    expect(getAdminSectionFromPathname("/admin/settings/not-an-area")).toBeNull();
    expect(getAdminSectionFromRouteSegment("not-a-section")).toBeNull();
    expect(getAdminSettingsAreaFromRouteSegment("not-an-area")).toBeNull();

    await expect(
      AdminSectionPage({
        params: Promise.resolve({ section: "not-a-section" })
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(navigationMocks.notFound).toHaveBeenCalledOnce();

    await expect(
      AdminSettingsSubsectionPage({
        params: Promise.resolve({ subsection: "not-an-area" })
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(navigationMocks.notFound).toHaveBeenCalledTimes(2);
  });

  it("accepts every canonical dynamic route without falling back", async () => {
    for (const [, , routeSegment] of canonicalSections) {
      await expect(
        AdminSectionPage({ params: Promise.resolve({ section: routeSegment }) })
      ).resolves.toBeNull();
    }
    expect(navigationMocks.notFound).not.toHaveBeenCalled();
  });

  it("accepts every canonical nested settings route", async () => {
    for (const [, , routeSegment] of canonicalSettingsAreas) {
      if (!routeSegment) continue;
      await expect(
        AdminSettingsSubsectionPage({
          params: Promise.resolve({ subsection: routeSegment })
        })
      ).resolves.toBeNull();
    }
    expect(navigationMocks.notFound).not.toHaveBeenCalled();
  });
});

describe("Admin route-driven navigation UI", () => {
  it("renders real Sidebar hrefs and derives active state from pathname", () => {
    const html = renderSidebar("/admin/models");

    for (const [, href] of canonicalSections) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toMatch(
      /<a aria-current="page"[^>]*href="\/admin\/models"|<a[^>]*href="\/admin\/models"[^>]*aria-current="page"/
    );
  });

  it.each([
    ["users", "customers", "/admin/users"],
    ["feedback", "customers", "/admin/feedback"],
    ["models", "aiPlatform", "/admin/models"],
    ["providerAccounts", "aiPlatform", "/admin/provider-accounts"],
    ["moderation", "trustSafety", "/admin/moderation"],
    ["plans", "commerce", "/admin/plans"],
    ["orders", "commerce", "/admin/orders"],
    ["payments", "commerce", "/admin/payments"],
    ["storageSubscriptions", "commerce", "/admin/storage-subscriptions"],
    ["settings", "siteProduct", "/admin/settings"],
    ["links", "siteProduct", "/admin/links"],
    ["contact", "siteProduct", "/admin/contact"],
    ["operations", "operations", "/admin/operations"],
    ["usage", "operations", "/admin/usage"],
    ["audit", "operations", "/admin/audit"]
  ] as const)(
    "highlights the active item and conceptual group for %s",
    (section, groupId, href) => {
      const html = renderSidebar(getAdminSectionHref(section));
      expect(adminNavigationGroups.map((group) => group.id)).toEqual([
        "customers",
        "aiPlatform",
        "trustSafety",
        "commerce",
        "siteProduct",
        "operations"
      ]);
      expect(html).toContain(
        `data-active="true" data-admin-navigation-group="${groupId}"`
      );
      expect(html).toMatch(
        new RegExp(
          `<a aria-current="page"[^>]*href="${href}"|<a[^>]*href="${href}"[^>]*aria-current="page"`
        )
      );
    }
  );

  it.each(canonicalSettingsAreas)(
    "highlights Site and Product for %s settings",
    (area, pathname) => {
      const html = renderSidebar(pathname);
      expect(getAdminSettingsAreaFromPathname(pathname)).toBe(area);
      expect(html).toContain(
        'data-active="true" data-admin-navigation-group="siteProduct"'
      );
      expect(html).toMatch(
        /<a aria-current="page"[^>]*href="\/admin\/settings"|<a[^>]*href="\/admin\/settings"[^>]*aria-current="page"/
      );
    }
  );

  it("renders addressable Site and Product settings navigation", () => {
    const html = renderToStaticMarkup(
      <I18nContext.Provider value={i18nValue}>
        <AdminSettingsAreaNavigation activeArea="workspace" />
      </I18nContext.Provider>
    );

    for (const [, href] of canonicalSettingsAreas) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toMatch(
      /<a aria-current="page"[^>]*href="\/admin\/settings\/workspace"|<a[^>]*href="\/admin\/settings\/workspace"[^>]*aria-current="page"/
    );
  });

  it.each([
    "users",
    "feedback",
    "plans",
    "orders",
    "payments",
    "storageSubscriptions",
    "settings",
    "links",
    "contact",
    "operations",
    "usage",
    "audit"
  ] as const)("keeps %s as its own addressable sidebar responsibility", (section) => {
    const html = renderSidebar(getAdminSectionHref(section));
    expect(getAdminSidebarSection(section)?.id).toBe(section);
    expect(html).toContain(`href="${getAdminSectionHref(section)}"`);
  });

  it("keeps the mobile close callback and does not call APIs on link activation", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onNavigate = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(
        <I18nContext.Provider value={i18nValue}>
          <AdminSidebar onNavigate={onNavigate} />
        </I18nContext.Provider>
      );
    });

    const moderationLink = host.querySelector<HTMLAnchorElement>(
      'a[href="/admin/moderation"]'
    );
    expect(moderationLink).not.toBeNull();
    await act(async () => moderationLink?.click());
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("persistent Admin data host", () => {
  it("does not reload broad Admin data when only the canonical pathname changes", async () => {
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
    const fetchMock = vi.fn(
      () => new Promise<Response>(() => undefined)
    );
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    const renderPersistentHost = () => (
      <I18nContext.Provider value={i18nValue}>
        <AdminAuthProvider>
          <AdminPageClient />
        </AdminAuthProvider>
      </I18nContext.Provider>
    );

    await act(async () => root?.render(renderPersistentHost()));
    const initialRequestCount = fetchMock.mock.calls.length;
    expect(initialRequestCount).toBeGreaterThan(0);

    navigationMocks.pathname = "/admin/models";
    await act(async () => root?.render(renderPersistentHost()));
    navigationMocks.pathname = "/admin/provider-accounts";
    await act(async () => root?.render(renderPersistentHost()));
    navigationMocks.pathname = "/admin/moderation";
    await act(async () => root?.render(renderPersistentHost()));
    navigationMocks.pathname = "/admin/settings";
    await act(async () => root?.render(renderPersistentHost()));
    navigationMocks.pathname = "/admin/settings/workspace";
    await act(async () => root?.render(renderPersistentHost()));
    navigationMocks.pathname = "/admin/settings/access";
    await act(async () => root?.render(renderPersistentHost()));
    navigationMocks.pathname = "/admin/settings/benefits";
    await act(async () => root?.render(renderPersistentHost()));

    expect(fetchMock).toHaveBeenCalledTimes(initialRequestCount);
  });
});

describe("Model create continuation", () => {
  it("keeps the drawer closed when Model creation resolves after close", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const pendingCreate = createDeferred<AdminAiModelSummary>();
    const onCreateRequest = vi.fn(() => pendingCreate.promise);
    const onCreateRoute = vi.fn();

    await act(async () => {
      root?.render(
        <I18nContext.Provider value={i18nValue}>
          <ModelsCreateContinuationHarness
            onCreateRequest={onCreateRequest}
            onCreateRoute={onCreateRoute}
          />
        </I18nContext.Provider>
      );
    });

    const exactButton = (label: string) =>
      Array.from(host?.querySelectorAll("button") ?? []).filter(
        (button) => button.textContent?.trim() === label
      );

    await act(async () => exactButton("Add model")[0]?.click());
    await act(async () => {
      exactButton("Add model").at(-1)?.click();
      await Promise.resolve();
    });
    expect(onCreateRequest).toHaveBeenCalledOnce();

    const closeButtons = Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Close model panel"]'
      )
    );
    expect(closeButtons.length).toBeGreaterThan(0);
    await act(async () => closeButtons.at(-1)?.click());
    expect(
      host.querySelector('button[aria-label="Close model panel"]')
    ).toBeNull();

    await act(async () => {
      pendingCreate.resolve(createdModelFixture);
      await pendingCreate.promise;
      await Promise.resolve();
    });

    expect(
      host.querySelector('button[aria-label="Close model panel"]')
    ).toBeNull();
    expect(host.textContent).not.toContain("Edit model");
    expect(onCreateRequest).toHaveBeenCalledOnce();
    expect(onCreateRoute).not.toHaveBeenCalled();
  });

  it("continues in the created Model drawer without implicit Route creation", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onCreateRequest = vi.fn(async () => createdModelFixture);
    const onCreateRoute = vi.fn();

    await act(async () => {
      root?.render(
        <I18nContext.Provider value={i18nValue}>
          <ModelsCreateContinuationHarness
            onCreateRequest={onCreateRequest}
            onCreateRoute={onCreateRoute}
          />
        </I18nContext.Provider>
      );
    });

    const exactButton = (label: string) =>
      Array.from(host?.querySelectorAll("button") ?? []).filter(
        (button) => button.textContent?.trim() === label
      );

    await act(async () => exactButton("Add model")[0]?.click());
    await act(async () => {
      exactButton("Add model").at(-1)?.click();
      await Promise.resolve();
    });

    expect(onCreateRequest).toHaveBeenCalledOnce();
    expect(onCreateRoute).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Edit model");
    expect(host.textContent).toContain("Model routes");
    expect(host.textContent).toContain("No routes yet");

    await act(async () => exactButton("Add route")[0]?.click());
    expect(onCreateRoute).toHaveBeenCalledOnce();
    expect(onCreateRoute).toHaveBeenCalledWith(createdModelFixture);
    expect(onCreateRequest).toHaveBeenCalledOnce();
  });
});
