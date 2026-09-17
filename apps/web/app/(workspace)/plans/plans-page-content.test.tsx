// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "../../../lib/i18n/types";
import { createTranslator, I18nContext } from "../../../lib/i18n/use-i18n";
import PlansPageContent from "./plans-page-content";

const plansTestState = vi.hoisted(() => ({
  shell: {
    token: null as string | null,
    remainingCredits: undefined as number | undefined
  },
  refreshQuota: vi.fn(),
  openAuthDialog: vi.fn()
}));

const billingSurfaceState = vi.hoisted(() => ({
  props: null as {
    token: string | null;
    remainingCredits: number | null;
    onOrderCreated?: () => void;
    onRequireLogin?: () => void;
  } | null
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/plans",
  useRouter: () => ({ push: vi.fn() })
}));

vi.mock("../../../components/workspace/workspace-shell-context", () => ({
  useWorkspaceShellContext: () => plansTestState
}));

vi.mock("../../../components/workspace/BillingPurchaseContent", () => ({
  BillingPurchaseContent: (props: {
    token: string | null;
    remainingCredits: number | null;
    onOrderCreated?: () => void;
    onRequireLogin?: () => void;
  }) => {
    billingSurfaceState.props = props;
    return (
      <div data-plans-billing-mock="true">
        <button type="button" onClick={() => props.onRequireLogin?.()}>
          Plan purchase surface
        </button>
      </div>
    );
  }
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderPlans(locale: Locale = "en-US") {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{ locale, setLocale: vi.fn(), t: createTranslator(locale) }}
    >
      <PlansPageContent />
    </I18nContext.Provider>
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  plansTestState.shell = { token: null, remainingCredits: undefined };
  plansTestState.refreshQuota.mockReset();
  plansTestState.openAuthDialog.mockReset();
  billingSurfaceState.props = null;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("PlansPageContent", () => {
  it("renders the public plans composition and model-cost explanation", () => {
    const html = renderPlans();

    expect(html).toContain('data-plans-page="true"');
    expect(html).toContain("Plans &amp; pricing");
    expect(html).toContain("How credits work");
    expect(html).toContain('href="/models"');
    expect(html).toContain('data-plans-billing-mock="true"');
    expect(billingSurfaceState.props).toMatchObject({
      token: null,
      remainingCredits: null,
      onOrderCreated: plansTestState.refreshQuota
    });
  });

  it("opens ordinary login without billing intent and performs no mutation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nContext.Provider
          value={{ locale: "en-US", setLocale: vi.fn(), t: createTranslator("en-US") }}
        >
          <PlansPageContent />
        </I18nContext.Provider>
      );
    });

    await act(async () => {
      host?.querySelector<HTMLButtonElement>("button")?.click();
    });

    expect(plansTestState.openAuthDialog).toHaveBeenCalledTimes(1);
    expect(plansTestState.openAuthDialog).toHaveBeenCalledWith({ mode: "login" });
    expect(plansTestState.openAuthDialog.mock.calls[0]?.[0]).not.toHaveProperty("intent");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(plansTestState.refreshQuota).not.toHaveBeenCalled();
  });

  it("passes authenticated shell token and quota refresh to the billing surface", () => {
    plansTestState.shell = { token: "token", remainingCredits: 432 };

    const html = renderPlans("zh-CN");

    expect(billingSurfaceState.props).toMatchObject({
      token: "token",
      remainingCredits: 432,
      onOrderCreated: plansTestState.refreshQuota
    });
    expect(html).toContain("套餐与价格");
  });
});
