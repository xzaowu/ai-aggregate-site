// @vitest-environment jsdom

import type { AccountOverview, AuthUser } from "@ai-aggregate/shared";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import {
  AccountPanel,
  syncAccountOverviewWithShell,
  type AccountLoadState
} from "./AccountPanel";
import {
  invokeWorkspaceBillingAction,
  useWorkspaceShellContext,
  WorkspaceShellProvider
} from "./workspace-shell-context";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testUser: AuthUser = {
  id: "user-1",
  email: "user@example.test",
  role: "USER",
  credits: 321,
  name: "Test user"
};

const testOverview: AccountOverview = {
  profile: testUser,
  quota: { remainingCredits: 321 },
  plan: { name: "Pro", status: "ACTIVE", expiresAt: null, nextBillingAt: null },
  storagePackage: {
    enabled: false,
    status: "INACTIVE",
    priceCredits: 0,
    durationDays: 0,
    autoRenewEnabled: false,
    autoRenewAvailable: false,
    description: "",
    startsAt: null,
    expiresAt: null
  },
  checkIn: {
    enabled: true,
    todayDate: "2026-07-12",
    todayCheckedIn: false,
    currentStreak: 1,
    dailyRewardCredits: 10,
    streakRewards: {},
    checkedDates: []
  },
  referral: {
    enabled: false,
    code: null,
    invitedCount: 0,
    totalRewardCredits: 0,
    inviterRewardCredits: 0,
    inviteeRewardCredits: 0,
    rewardTrigger: "",
    rulesText: "",
    registrationIntegration: "PREPARATION"
  },
  activities: [],
  benefits: {
    storagePackageEnabled: false,
    storagePackagePriceCredits: 0,
    storagePackageDurationDays: 0,
    storagePackageAutoRenewEnabled: false,
    storagePackageDescription: "",
    checkInEnabled: true,
    checkInDailyRewardCredits: 10,
    checkInStreakRewards: {},
    referralEnabled: false,
    referralInviterRewardCredits: 0,
    referralInviteeRewardCredits: 0,
    referralRewardTrigger: "",
    referralRulesText: ""
  }
};

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body
  };
}

function ShellMutationProbe() {
  const { refreshQuota, setAuthUser } = useWorkspaceShellContext();

  return (
    <>
      <button type="button" data-shell-quota-refresh onClick={refreshQuota}>
        refresh quota
      </button>
      <button type="button" data-shell-same-user onClick={() => setAuthUser(testUser)}>
        same user
      </button>
    </>
  );
}

function renderAccount(onOpenBilling = vi.fn()): string {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale: "en-US",
        setLocale: vi.fn(),
        t: createTranslator("en-US")
      }}
    >
      <AccountPanel
        token="token"
        user={{
          id: "user-1",
          email: "user@example.test",
          role: "USER",
          credits: 321
        }}
        remainingCredits={321}
        planName="Pro"
        onLogout={vi.fn()}
        onOpenBilling={onOpenBilling}
        initialOrders={[]}
        initialUsageLogs={[]}
      />
    </I18nContext.Provider>
  );
}

function renderGuestAccount(): string {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale: "en-US",
        setLocale: vi.fn(),
        t: createTranslator("en-US")
      }}
    >
      <AccountPanel
        token={null}
        user={null}
        remainingCredits={null}
        onLogout={vi.fn()}
        loadOverview={false}
      />
    </I18nContext.Provider>
  );
}

describe("AccountPanel billing and orders", () => {
  it("keeps guest Login and adds a View plans link", () => {
    const html = renderGuestAccount();

    expect(html).toContain("Log in");
    expect(html).toContain("View plans &amp; pricing");
    expect(html).toContain('href="/plans"');
  });

  it("shows account data, current plan, and account activity without recent usage", () => {
    const html = renderAccount();

    expect(html).toContain("user@example.test");
    expect(html).toContain("Current plan");
    expect(html).toContain("Pro");
    expect(html).toContain("321");
    expect(html).toContain("Orders and activations");
    expect(html).not.toContain("Recent usage");
    expect(html).not.toContain("Credit usage guide");
  });

  it("uses dialog actions for recharge and never links to /plans", () => {
    const onOpenBilling = vi.fn();
    const html = renderAccount(onOpenBilling);

    expect(html).toContain("Manage plans");
    expect(html).toContain("Recharge credits");
    expect(html).not.toContain('href="/plans"');
    invokeWorkspaceBillingAction(onOpenBilling);
    expect(onOpenBilling).toHaveBeenCalledTimes(1);
  });

  it("does not show quota usage guide or /plans links", () => {
    const html = renderAccount();
    expect(html).not.toContain("Credit usage guide");
    expect(html).not.toContain("quotaGuideTitle");
    expect(html).not.toContain('href="/plans"');
  });

  it("renders logout button in the action row", () => {
    const html = renderAccount();
    expect(html).toContain("Log out");
  });

  it("renders the productized account-center card grid without legacy top actions or recent usage", () => {
    const html = renderAccount();

    expect(html).toContain("Personal information");
    expect(html).toContain("Current plan");
    expect(html).toContain("Storage package");
    expect(html).toContain("Daily check-in");
    expect(html).toContain("Referral rewards");
    expect(html).toContain("Orders and activations");
    expect(html).toContain("Account security and actions");
    expect(html).not.toContain("Recent usage");
    expect(html).not.toContain("Security settings");
    expect(html).not.toContain("Save changes");
    expect(html).toContain('data-account-mobile-order="profile,subscription,storage,check-in,referral,activity,security"');
  });

  it("opens the existing billing surface from a pending order without payment orchestration", async () => {
    const onOpenBilling = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const pendingOverview: AccountOverview = {
      ...testOverview,
      activities: [
        {
          id: "order:pending-order",
          kind: "ORDER",
          title: "Pro credits",
          status: "PENDING",
          amount: 990,
          creditsDelta: 0,
          createdAt: "2026-08-20T08:00:00.000Z",
          completedAt: null
        }
      ]
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <I18nContext.Provider value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}>
          <AccountPanel
            token="token"
            user={testUser}
            remainingCredits={321}
            planName="Pro"
            onLogout={vi.fn()}
            onOpenBilling={onOpenBilling}
            initialOverview={pendingOverview}
            loadOverview={false}
          />
        </I18nContext.Provider>
      );
    });

    const resumeButton = host.querySelector<HTMLButtonElement>('[data-account-pending-order-recovery] [data-account-payment-resume]');
    expect(resumeButton?.textContent).toContain("Continue payment");
    await act(async () => resumeButton?.click());

    expect(onOpenBilling).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
});

describe("AccountPanel user Order cancellation", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;

  function orderOverview(
    status: AccountOverview["activities"][number]["status"] = "PENDING"
  ): AccountOverview {
    return {
      ...testOverview,
      activities: [
        {
          id: "order:pending-order",
          kind: "ORDER",
          title: "Pro credits",
          status,
          amount: 990,
          creditsDelta: status === "SUCCESS" ? 100 : 0,
          createdAt: "2026-08-20T08:00:00.000Z",
          completedAt:
            status === "SUCCESS" ? "2026-08-20T08:05:00.000Z" : null
        }
      ]
    };
  }

  async function renderCancelPanel(
    status: AccountOverview["activities"][number]["status"] = "PENDING",
    isMobileSurface = false
  ) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <I18nContext.Provider value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}>
          <AccountPanel
            token="token"
            user={testUser}
            remainingCredits={321}
            planName="Pro"
            onLogout={vi.fn()}
            onOpenBilling={vi.fn()}
            initialOverview={orderOverview(status)}
            loadOverview={false}
            isMobileSurface={isMobileSurface}
          />
        </I18nContext.Provider>
      );
    });
  }

  function cancelButton() {
    return host?.querySelector<HTMLButtonElement>("[data-account-order-cancel]") ?? null;
  }

  function confirmButton() {
    return Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')
    ).find((button) => button.textContent === "Cancel order") ?? null;
  }

  function stubActivityScroll() {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn()
    });
  }

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    host?.remove();
    host = null;
    document.body.innerHTML = "";
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
    vi.unstubAllGlobals();
  });

  it("shows Continue payment and Cancel order only for PENDING orders and asks for confirmation", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await renderCancelPanel();

    expect(host?.querySelector('[data-account-payment-resume="true"]')).not.toBeNull();
    expect(cancelButton()?.textContent).toBe("Cancel order");

    await act(async () => cancelButton()?.click());

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Cancel this order?");
    expect(document.body.textContent).toContain(
      "It does not cancel a payment already in progress with the payment provider."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts once and immediately removes pending actions after cancellation succeeds", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          order: { id: "pending-order", status: "CANCELLED" },
          alreadyCancelled: false
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderCancelPanel();

    await act(async () => cancelButton()?.click());
    await act(async () => {
      confirmButton()?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/orders/pending-order/cancel", {
      method: "POST",
      headers: { Authorization: "Bearer token" }
    });
    expect(host?.querySelector('[data-account-order-cancel="true"]')).toBeNull();
    expect(host?.querySelector('[data-account-payment-resume="true"]')).toBeNull();
    expect(host?.querySelector('[data-account-pending-order-recovery="true"]')).toBeNull();
    expect(host?.querySelector("tbody tr")?.textContent).toContain("Cancelled");
    expect(host?.querySelector("tbody tr")?.textContent).not.toContain("Failed");
    expect(document.body.textContent).toContain("Order cancelled.");
  });

  it("routes a desktop Activity Modal cancellation through the shared confirmation", async () => {
    stubActivityScroll();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          items: orderOverview().activities,
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderCancelPanel();

    const viewMore = Array.from(host?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent?.trim() === "View more");
    await act(async () => {
      viewMore?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const activityDialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-labelledby="account-activity-dialog"]'
    );
    expect(activityDialog?.textContent).toContain("Continue payment");
    const modalCancel = activityDialog?.querySelector<HTMLButtonElement>(
      '[data-account-order-cancel="true"]'
    );
    expect(modalCancel?.textContent).toBe("Cancel order");

    await act(async () => modalCancel?.click());

    expect(document.querySelector('[aria-labelledby="account-activity-dialog"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Cancel this order?");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/cancel"))).toBe(false);
  });

  it("routes a mobile Activity drawer cancellation through the shared confirmation", async () => {
    stubActivityScroll();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: orderOverview().activities,
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderCancelPanel("PENDING", true);

    const activityEntry = Array.from(host?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent?.includes("Orders & activity"));
    await act(async () => {
      activityEntry?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const drawer = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-labelledby="m5-account-activity-title"]'
    );
    expect(drawer?.textContent).toContain("Cancel order");
    const drawerCancel = drawer?.querySelector<HTMLButtonElement>(
      '[data-account-order-cancel="true"]'
    );

    await act(async () => drawerCancel?.click());

    expect(document.querySelector('[aria-labelledby="m5-account-activity-title"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Cancel this order?");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/cancel"))).toBe(false);
  });

  it("uses a synchronous in-flight guard against duplicate submit", async () => {
    let resolveRequest!: (response: Response) => void;
    const request = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => request);
    vi.stubGlobal("fetch", fetchMock);
    await renderCancelPanel();

    await act(async () => cancelButton()?.click());
    await act(async () => {
      confirmButton()?.click();
      confirmButton()?.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Cancelling…");

    await act(async () => {
      resolveRequest(
        new Response(
          JSON.stringify({ order: { id: "pending-order", status: "CANCELLED" } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
      await request;
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps PENDING actions and shows only a safe error after API failure", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "sensitive internal reason" }), {
        status: 409,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderCancelPanel();

    await act(async () => cancelButton()?.click());
    await act(async () => {
      confirmButton()?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cancelButton()).not.toBeNull();
    expect(host?.querySelector('[data-account-payment-resume="true"]')).not.toBeNull();
    expect(document.body.textContent).toContain(
      "We could not cancel this order. Refresh its status and try again."
    );
    expect(document.body.textContent).not.toContain("sensitive internal reason");
  });

  it("does not show pending payment or cancel actions for CANCELLED and PAID rows", async () => {
    await renderCancelPanel("CANCELLED");
    expect(cancelButton()).toBeNull();
    expect(host?.querySelector('[data-account-payment-resume="true"]')).toBeNull();
    expect(host?.querySelector("tbody tr")?.textContent).toContain("Cancelled");
    expect(host?.querySelector("tbody tr")?.textContent).not.toContain("Failed");

    await act(async () => root?.unmount());
    root = null;
    host?.remove();
    host = null;
    await renderCancelPanel("FAILED");
    expect(cancelButton()).toBeNull();
    expect(document.querySelector('[data-account-payment-resume="true"]')).toBeNull();
    expect(document.querySelector("tbody tr")?.textContent).toContain("Failed");
    expect(document.querySelector("tbody tr")?.textContent).not.toContain("Cancelled");

    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    host = null;
    await renderCancelPanel("SUCCESS");
    expect(cancelButton()).toBeNull();
    expect(document.querySelector('[data-account-payment-resume="true"]')).toBeNull();
  });
});

describe("AccountPanel UX-5.1 changes", () => {
  function renderWithActivities(): string {
    const overviewWithActivities = {
      ...testOverview,
      activities: [
        {
          id: "order:ord1",
          kind: "ORDER" as const,
          title: "Plan purchase",
          status: "SUCCESS" as const,
          amount: 100,
          creditsDelta: 100,
          createdAt: "2026-07-12T00:00:00.000Z",
          completedAt: "2026-07-12T00:00:00.000Z"
        }
      ]
    };
    return renderToStaticMarkup(
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
      >
        <AccountPanel
          token="token"
          user={testUser}
          remainingCredits={321}
          planName="Pro"
          onLogout={vi.fn()}
          initialOverview={overviewWithActivities}
        />
      </I18nContext.Provider>
    );
  }

  it("renders View more button when activities exist", () => {
    const html = renderWithActivities();
    expect(html).toContain("View more");
    expect(html).not.toContain("Recent");
  });

  it("storage card shows price as credits/mo", () => {
    const html = renderAccount();
    expect(html).toContain("credits/mo");
    expect(html).not.toContain("credits / period");
  });

  it("storage card has bottom tip with recommendation text", () => {
    const html = renderAccount();
    expect(html).toContain("Recommended for users");
  });

  it("activate button shows simple text without price", () => {
    const html = renderAccount();
    expect(html).toContain("Activate storage");
  });

  it("no inline avatar error message is rendered in the card", () => {
    const html = renderAccount();
    expect(html).not.toMatch(/max-w-\[180px\].*text-red-600/);
  });
});

describe("AccountPanel UX-5.2 CardTitle layout", () => {
  it("places storage status label next to the title, not at far right", () => {
    const html = renderAccount();
    expect(html).toContain("Not active");
    // The storage status badge should be inside the title line, not pushed to the right with justify-between
    expect(html).toMatch(/Storage package.*Not active/);
  });

  it("View more button is rendered directly, not wrapped in a badge", () => {
    const overviewWithActivities = {
      ...testOverview,
      activities: [
        {
          id: "order:ord1",
          kind: "ORDER" as const,
          title: "Plan purchase",
          status: "SUCCESS" as const,
          amount: 100,
          creditsDelta: 100,
          createdAt: "2026-07-12T00:00:00.000Z",
          completedAt: "2026-07-12T00:00:00.000Z"
        }
      ]
    };
    const html = renderToStaticMarkup(
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
      >
        <AccountPanel
          token="token"
          user={testUser}
          remainingCredits={321}
          planName="Pro"
          onLogout={vi.fn()}
          initialOverview={overviewWithActivities}
        />
      </I18nContext.Provider>
    );
    // The View more button is a single <button> element rendered via CardTitle's action prop
    expect(html).toContain("View more");
    // It should be a button, not a button wrapped in a badge span
    const buttonIndex = html.indexOf("<button");
    const viewMoreIndex = html.indexOf("View more");
    expect(buttonIndex).toBeGreaterThan(0);
    expect(viewMoreIndex).toBeGreaterThan(buttonIndex);
  });
});

describe("AccountPanel overview request lifecycle", () => {
  let mountedRoot: ReturnType<typeof createRoot> | null = null;

  afterEach(() => {
    if (mountedRoot) {
      act(() => {
        mountedRoot?.unmount();
      });
      mountedRoot = null;
    }
    window.localStorage.clear();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("keeps equal shell quota state referentially stable", () => {
    const existingState: AccountLoadState = { status: "ready", overview: testOverview };

    const same = syncAccountOverviewWithShell(existingState, {
      remainingCredits: testOverview.quota.remainingCredits,
      planName: testOverview.plan.name
    });
    const changed = syncAccountOverviewWithShell(existingState, {
      remainingCredits: testOverview.quota.remainingCredits + 1,
      planName: "Max"
    });

    expect(same).toBe(existingState);
    expect(changed).not.toBe(existingState);
    expect(changed).toMatchObject({
      status: "ready",
      overview: { quota: { remainingCredits: 322 }, plan: { name: "Max" } }
    });
  });

  it("does not reload overview for same shell values, but permits one explicit refresh", async () => {
    let overviewCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/account/overview") || url.endsWith("/account/overview")) {
        overviewCalls += 1;
        if (overviewCalls <= 2) return jsonResponse(testOverview);
        return { ok: false, status: 500, json: async () => ({}) };
      }
      if (url.startsWith("/api/quota/me") || url.endsWith("/quota/me")) {
        return jsonResponse({ remainingCredits: 321, planName: "Pro" });
      }
      if (url.startsWith("/api/account/check-in") || url.endsWith("/account/check-in")) {
        return jsonResponse({});
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("ai-aggregate-token", "token");
    window.localStorage.setItem("ai-aggregate-user", JSON.stringify(testUser));

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mountedRoot = root;

    await act(async () => {
      root.render(
        <I18nContext.Provider
          value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
        >
          <WorkspaceShellProvider gateUntilHydrated={false}>
            <ShellMutationProbe />
            <AccountPanel
              token="token"
              user={testUser}
              remainingCredits={321}
              planName="Pro"
              onLogout={vi.fn()}
            />
          </WorkspaceShellProvider>
        </I18nContext.Provider>
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(host.querySelector('[data-account-page="ux-5"]')).toBeTruthy();
    expect(overviewCalls).toBe(1);

    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-shell-same-user]")?.click();
      host.querySelector<HTMLButtonElement>("[data-shell-quota-refresh]")?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(overviewCalls).toBe(1);

    await act(async () => {
      const checkInButton = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("Check in"));
      checkInButton?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(overviewCalls).toBe(2);

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const callsAfterUnmount = overviewCalls;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(overviewCalls).toBe(callsAfterUnmount);
  });

  it("uses cache: no-store for overview fetch", async () => {
    let overviewInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.endsWith("/account/overview") || url.includes("/account/overview")) {
        overviewInit = init;
        return jsonResponse(testOverview);
      }
      if (url.endsWith("/quota/me") || url.includes("/quota/me")) {
        return jsonResponse({ remainingCredits: 321, planName: "Pro" });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("ai-aggregate-token", "token");
    window.localStorage.setItem("ai-aggregate-user", JSON.stringify(testUser));

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mountedRoot = root;

    await act(async () => {
      root.render(
        <I18nContext.Provider
          value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
        >
          <WorkspaceShellProvider gateUntilHydrated={false}>
            <AccountPanel
              token="token"
              user={testUser}
              remainingCredits={321}
              planName="Pro"
              onLogout={vi.fn()}
            />
          </WorkspaceShellProvider>
        </I18nContext.Provider>
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(overviewInit?.cache).toBe("no-store");
    await act(() => root.unmount());
  });
});

describe("AccountPanel account security dialogs", () => {
  let securityRoot: ReturnType<typeof createRoot> | null = null;
  let securityHost: HTMLDivElement | null = null;

  function securityResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers }
    });
  }

  function deferred<T>() {
    let resolvePromise!: (value: T | PromiseLike<T>) => void;
    let rejectPromise!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    return { promise, resolve: resolvePromise, reject: rejectPromise };
  }

  async function renderSecurityPanel({
    token = "token",
    onLogout = vi.fn()
  }: {
    token?: string | null;
    onLogout?: () => void;
  } = {}) {
    securityHost = document.createElement("div");
    document.body.append(securityHost);
    securityRoot = createRoot(securityHost);
    await act(async () => {
      securityRoot?.render(
        <I18nContext.Provider value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}>
          <AccountPanel
            token={token}
            user={testUser}
            remainingCredits={321}
            planName="Pro"
            onLogout={onLogout}
            initialOverview={testOverview}
            loadOverview={false}
          />
        </I18nContext.Provider>
      );
    });
    return onLogout;
  }

  async function settle() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function clickButton(label: string) {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.textContent?.trim() === label);
    if (!button) throw new Error("ACCOUNT_SECURITY_BUTTON_MISSING");
    await act(async () => {
      button.click();
    });
  }

  function passwordInputs(): [HTMLInputElement, HTMLInputElement, HTMLInputElement] {
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
    const current = inputs[0];
    const next = inputs[1];
    const confirmation = inputs[2];
    if (!current || !next || !confirmation) {
      throw new Error("ACCOUNT_SECURITY_PASSWORD_INPUTS_MISSING");
    }
    return [current, next, confirmation];
  }

  async function setInputValue(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function typeIntoInput(input: HTMLInputElement, value: string) {
    for (const character of value) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, `${input.value}${character}`);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
  }

  async function fillPasswords(current: string, next: string, confirmation = next) {
    const [currentInput, newInput, confirmationInput] = passwordInputs();
    await setInputValue(currentInput, current);
    await setInputValue(newInput, next);
    await setInputValue(confirmationInput, confirmation);
  }

  async function submitPasswordDialog() {
    const form = document.querySelector<HTMLFormElement>("[role=dialog] form");
    if (!form) throw new Error("ACCOUNT_SECURITY_PASSWORD_FORM_MISSING");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  async function closeSecurityDialog() {
    const button = document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]');
    if (!button) throw new Error("ACCOUNT_SECURITY_CLOSE_BUTTON_MISSING");
    await act(async () => {
      button.click();
    });
  }

  afterEach(async () => {
    await act(async () => {
      securityRoot?.unmount();
    });
    securityHost?.remove();
    securityRoot = null;
    securityHost = null;
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the existing ready security card and opens an accessible password dialog only on demand", async () => {
    await renderSecurityPanel();
    expect(document.querySelector('[data-account-card="security"]')).not.toBeNull();
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);

    await clickButton("Change password");

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("account-change-password-dialog");
    const [current, next, confirmation] = passwordInputs();
    expect(current.autocomplete).toBe("current-password");
    expect(next.autocomplete).toBe("new-password");
    expect(confirmation.autocomplete).toBe("new-password");
    expect(document.activeElement).toBe(current);
  });

  it("keeps focus on each password input across controlled parent rerenders", async () => {
    await renderSecurityPanel();
    await clickButton("Change password");

    const [current, next, confirmation] = passwordInputs();
    expect(document.activeElement).toBe(current);

    await typeIntoInput(current, "a");
    expect(current.value).toBe("a");
    expect(document.activeElement).toBe(current);
    expect(document.activeElement).not.toBe(document.querySelector('[role="dialog"] button[aria-label="Close"]'));

    await typeIntoInput(current, "bc");
    expect(current.value).toBe("abc");
    expect(document.activeElement).toBe(current);

    await act(async () => next.focus());
    await typeIntoInput(next, "new");
    expect(next.value).toBe("new");
    expect(document.activeElement).toBe(next);

    await act(async () => confirmation.focus());
    await typeIntoInput(confirmation, "confirm");
    expect(confirmation.value).toBe("confirm");
    expect(document.activeElement).toBe(confirmation);
  });

  it("clears passwords and errors through cancel, Escape, backdrop, and a fresh open", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await renderSecurityPanel();

    await clickButton("Change password");
    await fillPasswords("current-password", "short", "short");
    await submitPasswordDialog();
    expect(document.body.textContent).toContain("New password must be at least 8 characters.");

    await clickButton("Cancel");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await clickButton("Change password");
    expect(passwordInputs()[0].value).toBe("");
    expect(document.activeElement).toBe(passwordInputs()[0]);
    expect(document.body.textContent).not.toContain("New password must be at least 8 characters.");

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await clickButton("Change password");
    await act(async () => document.querySelector<HTMLElement>("[data-account-security-backdrop]")?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true })
    ));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects all local password-validation failures before a request, including Unicode byte boundaries", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await renderSecurityPanel();
    await clickButton("Change password");

    await fillPasswords("", "new-password");
    await submitPasswordDialog();
    expect(document.body.textContent).toContain("Enter your current password.");

    await fillPasswords("😀".repeat(19), "new-password");
    await submitPasswordDialog();
    expect(document.body.textContent).toContain("The current password is incorrect.");

    await fillPasswords("current-password", "😀😀😀😀😀😀😀");
    await submitPasswordDialog();
    expect(document.body.textContent).toContain("New password must be at least 8 characters.");

    const password73Bytes = `${"😀".repeat(18)}a`;
    expect(new TextEncoder().encode(password73Bytes)).toHaveLength(73);
    await fillPasswords("current-password", password73Bytes);
    await submitPasswordDialog();
    expect(document.body.textContent).toContain("New password must be 72 UTF-8 bytes or fewer.");

    await fillPasswords("current-password", "new-password", "other-password");
    await submitPasswordDialog();
    expect(document.body.textContent).toContain("New password confirmation does not match.");

    await fillPasswords("same-password", "same-password");
    await submitPasswordDialog();
    expect(document.body.textContent).toContain("New password must be different from the current password.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits the valid Unicode code-point and UTF-8 boundaries exactly once", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      securityResponse({ status: "PASSWORD_CHANGED" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const onLogout = await renderSecurityPanel();
    await clickButton("Change password");

    const password72Bytes = "😀".repeat(18);
    expect(Array.from(password72Bytes)).toHaveLength(18);
    expect(new TextEncoder().encode(password72Bytes)).toHaveLength(72);
    await fillPasswords("current-password", password72Bytes);
    await submitPasswordDialog();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const options = fetchMock.mock.calls[0]?.[1];
    expect(options?.method).toBe("POST");
    const requestBody = JSON.parse(String(options?.body)) as Record<string, unknown>;
    expect(Object.keys(requestBody)).toEqual(["currentPassword", "newPassword"]);
    expect("userId" in requestBody).toBe(false);
    expect("email" in requestBody).toBe(false);
    expect("sessionVersion" in requestBody).toBe(false);
  });

  it("uses a synchronous lock and disables every password-dialog close path while pending", async () => {
    const request = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => request.promise);
    vi.stubGlobal("fetch", fetchMock);
    await renderSecurityPanel();
    await clickButton("Change password");
    await fillPasswords("current-password", "new-password");
    const form = document.querySelector<HTMLFormElement>("[role=dialog] form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).every((input) => input.disabled)).toBe(true);
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).every((button) => button.disabled)).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await act(async () => document.querySelector<HTMLElement>("[data-account-security-backdrop]")?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true })
    ));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    request.resolve(securityResponse({ message: "raw server message" }, 500));
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it.each([
    "CURRENT_PASSWORD_INVALID",
    "NEW_PASSWORD_INVALID",
    "NEW_PASSWORD_MUST_DIFFER",
    "CHANGE_PASSWORD_INVALID_REQUEST"
  ] as const)("keeps authentication for password-change 400 %s", async (code) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      securityResponse({ code, message: "raw server message" }, 400)
    );
    vi.stubGlobal("fetch", fetchMock);
    const onLogout = await renderSecurityPanel();
    await clickButton("Change password");
    await fillPasswords("current-password", "new-password");
    await submitPasswordDialog();
    await settle();

    expect(onLogout).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent?.includes("raw server message")).toBe(false);
    expect(passwordInputs()[0].value).toBe("");
  });

  it("logs out on password-change 401 but retains authentication for rate, network, and server failures", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(securityResponse({ message: "raw server message" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const onLogout = await renderSecurityPanel();
    await clickButton("Change password");
    await fillPasswords("current-password", "new-password");
    await submitPasswordDialog();
    await settle();
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await clickButton("Change password");
    fetchMock.mockRejectedValueOnce(new Error("network raw message"));
    await fillPasswords("current-password", "new-password");
    await submitPasswordDialog();
    await settle();
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Account security service is unavailable");

    fetchMock.mockResolvedValueOnce(securityResponse({ retryAfterSeconds: 12, message: "raw server message" }, 429));
    await fillPasswords("current-password", "new-password");
    await submitPasswordDialog();
    await settle();
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Try again in 12 seconds.");

    fetchMock.mockResolvedValueOnce(securityResponse({ message: "raw server message" }, 503));
    await fillPasswords("current-password", "new-password");
    await submitPasswordDialog();
    await settle();
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("We could not complete this request.");
    expect(document.body.textContent?.includes("raw server message")).toBe(false);
  });

  it("opens a device-management explanation without fabricated devices and requires a same-dialog confirmation", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await renderSecurityPanel();
    await clickButton("Login device management");

    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    expect(document.body.textContent).toContain("account-level sign-in sessions");
    expect(document.body.textContent).not.toContain("IP address");
    expect(document.body.textContent).not.toContain("Last active");
    expect(fetchMock).not.toHaveBeenCalled();

    await clickButton("Log out all devices");
    expect(document.body.textContent).toContain("This also logs out the current browser.");
    expect(fetchMock).not.toHaveBeenCalled();

    await clickButton("Cancel");
    expect(document.body.textContent).toContain("Regular Log out only signs out this browser.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revokes sessions only at final confirmation, uses its synchronous lock, and logs out on success", async () => {
    const request = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => request.promise);
    vi.stubGlobal("fetch", fetchMock);
    const onLogout = await renderSecurityPanel();
    await clickButton("Login device management");
    await clickButton("Log out all devices");
    const confirmButton = Array.from(document.querySelectorAll<HTMLButtonElement>("[role=dialog] button"))
      .find((button) => button.textContent?.trim() === "Log out all devices");
    await act(async () => {
      confirmButton?.click();
      confirmButton?.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = fetchMock.mock.calls[0]?.[1];
    expect(options?.body).toBeUndefined();
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).every((button) => button.disabled)).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    request.resolve(securityResponse({ status: "SESSIONS_REVOKED" }));
    await settle();
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("handles revoke 401 as logout and keeps authentication for 429 and 500", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(securityResponse({ message: "raw server message" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const onLogout = await renderSecurityPanel();
    await clickButton("Login device management");
    await clickButton("Log out all devices");
    await clickButton("Log out all devices");
    await settle();
    expect(onLogout).toHaveBeenCalledTimes(1);

    await clickButton("Login device management");
    await clickButton("Log out all devices");
    fetchMock.mockResolvedValueOnce(securityResponse({ retryAfterSeconds: 9, message: "raw server message" }, 429));
    await clickButton("Log out all devices");
    await settle();
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Try again in 9 seconds.");

    fetchMock.mockResolvedValueOnce(securityResponse({ message: "raw server message" }, 500));
    await clickButton("Log out all devices");
    await settle();
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("We could not complete this request.");
    expect(document.body.textContent?.includes("raw server message")).toBe(false);
  });

  it("keeps ordinary logout direct and makes email and invoice entry points placeholders without requests or navigation", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const onLogout = await renderSecurityPanel();
    const initialPath = window.location.pathname;

    await clickButton("Change bound email");
    expect(document.body.textContent).toContain("Coming soon.");
    expect(fetchMock).not.toHaveBeenCalled();
    await closeSecurityDialog();

    await clickButton("Invoices and billing");
    expect(document.body.textContent).toContain("Coming soon.");
    expect(fetchMock).not.toHaveBeenCalled();
    await closeSecurityDialog();

    await clickButton("Log out");
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(initialPath);
  });

  it("does not render security dialogs for unauthenticated state or write browser storage", async () => {
    const storageSetItem = vi.spyOn(Storage.prototype, "setItem");
    await renderSecurityPanel({ token: null });

    expect(document.querySelector('[data-account-card="security"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(storageSetItem).not.toHaveBeenCalled();
  });
});
