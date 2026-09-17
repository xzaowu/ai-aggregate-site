import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "../../lib/i18n/types";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import { SidebarAccountCard } from "./SidebarAccountCard";
import type { AuthUser } from "@ai-aggregate/shared";

const navigationState = vi.hoisted(() => ({
  pathname: "/"
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname
}));

const mockUser: AuthUser = {
  id: "user-1",
  email: "test@example.com",
  name: "Test User",
  role: "USER",
  credits: 790
};

const mockAdmin: AuthUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin User",
  role: "ADMIN",
  credits: 5000
};

function renderWithLocale(node: React.ReactNode, locale: Locale = "zh-CN") {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      {node}
    </I18nContext.Provider>
  );
}

function renderCard(opts: {
  user?: AuthUser | null;
  isLoggedIn?: boolean;
  isAdmin?: boolean;
  remainingCredits?: number;
  planName?: string;
  isCollapsed?: boolean;
  locale?: Locale;
} = {}) {
  const {
    user = mockUser,
    isLoggedIn = true,
    isAdmin = false,
    remainingCredits = 790,
    planName = "Free",
    isCollapsed = false,
    locale = "zh-CN"
  } = opts;
  return renderWithLocale(
    <SidebarAccountCard
      user={user}
      isLoggedIn={isLoggedIn}
      isAdmin={isAdmin}
      remainingCredits={remainingCredits}
      planName={planName}
      openBillingDialog={vi.fn()}
      isCollapsed={isCollapsed}
    />,
    locale
  );
}

describe("SidebarAccountCard — logged-in user (expanded)", () => {
  it("displays the user name", () => {
    const html = renderCard();

    expect(html).toContain("Test User");
  });

  it("displays credits as 额度：790 in Chinese", () => {
    const html = renderCard();

    expect(html).toContain("额度：790");
    expect(html).not.toContain("剩余额度");
  });

  it("displays Credits: 790 in English", () => {
    const html = renderCard({ locale: "en-US" });

    expect(html).toContain("Credits: 790");
    expect(html).not.toContain("Remaining Credits");
  });

  it("renders a recharge button", () => {
    const html = renderCard();

    expect(html).toContain("充值");
  });

  it("recharge button in English says Recharge", () => {
    const html = renderCard({ locale: "en-US" });

    expect(html).toContain("Recharge");
  });

  it("renders the recharge button as full-width below user area", () => {
    const html = renderCard();

    expect(html).toContain("wallet-cards");
    expect(html).toContain("border-t");
  });

  it("renders the user avatar", () => {
    const html = renderCard();

    expect(html).toContain("T");
  });

  it("has an expandable user info area with aria-expanded", () => {
    const html = renderCard();

    expect(html).toContain("aria-expanded");
  });

  it("has aria-haspopup menu attribute", () => {
    const html = renderCard();

    expect(html).toContain('aria-haspopup="menu"');
  });

  it("does not link to /plans", () => {
    const html = renderCard();

    expect(html).not.toContain('href="/plans"');
  });

  it("generates a nickname when name is missing (not email prefix)", () => {
    const noNameUser: AuthUser = {
      id: "user-2-nick",
      email: "hello@example.com",
      name: undefined,
      role: "USER",
      credits: 100
    };
    const html = renderWithLocale(
      <SidebarAccountCard
        user={noNameUser}
        isLoggedIn
        isAdmin={false}
        remainingCredits={100}
        planName="Free"
        openBillingDialog={vi.fn()}
        isCollapsed={false}
      />,
      "zh-CN"
    );

    expect(html).not.toContain("hello");
    expect(html).not.toContain("hello@example.com");
  });

  it("generates a nickname when name is undefined and email prefix is empty", () => {
    const noNameUser: AuthUser = {
      id: "user-3-nick",
      email: "@example.com",
      name: undefined,
      role: "USER",
      credits: 0
    };
    const html = renderWithLocale(
      <SidebarAccountCard
        user={noNameUser}
        isLoggedIn
        isAdmin={false}
        remainingCredits={0}
        planName="Free"
        openBillingDialog={vi.fn()}
        isCollapsed={false}
      />,
      "zh-CN"
    );

    expect(html).not.toContain("@example.com");
  });

  it("has a vertical card layout with border-t separator", () => {
    const html = renderCard();

    expect(html).toContain("border-t");
    expect(html).toContain("rounded-b-2xl");
  });

  it("recharge button is a button element (not a link)", () => {
    const html = renderCard();

    expect(html).not.toContain('href="/plans"');
    expect(html).toContain(">充值</button>");
  });

  it("card has hover and focus styles on user trigger area", () => {
    const html = renderCard();

    expect(html).toContain("focus-visible:ring-inset");
    expect(html).toContain("focus-visible:ring-indigo-500");
  });
});

describe("SidebarAccountCard — user menu", () => {
  it("keeps the closed portal menu out of document flow", () => {
    const source = readFileSync(
      new URL("./SidebarAccountCard.tsx", import.meta.url),
      "utf8"
    );

    expect(source.match(/className=\{`fixed rounded-xl/g)).toHaveLength(2);
  });

  it("menu items render via portal (not in SSR output)", () => {
    const html = renderCard();

    expect(html).not.toContain('id="account-card-menu-portal"');
  });

  it("menu does not contain Language", () => {
    const html = renderCard();

    expect(html).not.toContain("语言");
  });

  it("menu does not contain Theme", () => {
    const html = renderCard();

    expect(html).not.toContain("主题");
  });

  it("menu does not contain Logout", () => {
    const html = renderCard();

    expect(html).not.toContain("退出");
  });

  it("menu does not contain Recharge", () => {
    const html = renderCard();

    expect(html).not.toContain('href="/plans"');
  });
});

describe("SidebarAccountCard — guest user", () => {
  it("displays guest label", () => {
    const html = renderWithLocale(
      <SidebarAccountCard
        user={null}
        isLoggedIn={false}
        isAdmin={false}
        remainingCredits={0}
        openBillingDialog={vi.fn()}
        isCollapsed={false}
      />,
      "zh-CN"
    );

    expect(html).toContain("游客");
  });

  it("displays Guest in English", () => {
    const html = renderWithLocale(
      <SidebarAccountCard
        user={null}
        isLoggedIn={false}
        isAdmin={false}
        remainingCredits={0}
        openBillingDialog={vi.fn()}
        isCollapsed={false}
      />,
      "en-US"
    );

    expect(html).toContain("Guest");
  });

  it("does not display credits for guest", () => {
    const html = renderWithLocale(
      <SidebarAccountCard
        user={null}
        isLoggedIn={false}
        isAdmin={false}
        remainingCredits={0}
        openBillingDialog={vi.fn()}
        isCollapsed={false}
      />,
      "zh-CN"
    );

    expect(html).not.toContain("额度");
  });

  it("does not display recharge for guest", () => {
    const html = renderWithLocale(
      <SidebarAccountCard
        user={null}
        isLoggedIn={false}
        isAdmin={false}
        remainingCredits={0}
        openBillingDialog={vi.fn()}
        isCollapsed={false}
      />,
      "zh-CN"
    );

    expect(html).not.toContain("充值");
  });

  it("displays Login button for guest", () => {
    const html = renderWithLocale(
      <SidebarAccountCard
        user={null}
        isLoggedIn={false}
        isAdmin={false}
        remainingCredits={0}
        openBillingDialog={vi.fn()}
        isCollapsed={false}
      />,
      "zh-CN"
    );

    expect(html).toContain("登录");
    expect(html).not.toContain('href="/login"');
  });

  it("displays Login in English for guest", () => {
    const html = renderWithLocale(
      <SidebarAccountCard
        user={null}
        isLoggedIn={false}
        isAdmin={false}
        remainingCredits={0}
        openBillingDialog={vi.fn()}
        isCollapsed={false}
      />,
      "en-US"
    );

    expect(html).toContain("Login");
    expect(html).not.toContain('href="/login"');
  });

  it("does not display Register for guest (no /register route)", () => {
    const html = renderWithLocale(
      <SidebarAccountCard
        user={null}
        isLoggedIn={false}
        isAdmin={false}
        remainingCredits={0}
        openBillingDialog={vi.fn()}
        isCollapsed={false}
      />,
      "zh-CN"
    );

    expect(html).not.toContain("注册");
    expect(html).not.toContain("Register");
    expect(html).not.toContain('href="/register"');
  });

  it("does not display Profile for guest", () => {
    const html = renderWithLocale(
      <SidebarAccountCard
        user={null}
        isLoggedIn={false}
        isAdmin={false}
        remainingCredits={0}
        openBillingDialog={vi.fn()}
        isCollapsed={false}
      />,
      "zh-CN"
    );

    expect(html).not.toContain("个人中心");
  });

  it("does not display Admin for guest", () => {
    const html = renderWithLocale(
      <SidebarAccountCard
        user={null}
        isLoggedIn={false}
        isAdmin={false}
        remainingCredits={0}
        openBillingDialog={vi.fn()}
        isCollapsed={false}
      />,
      "zh-CN"
    );

    expect(html).not.toContain("后台管理");
  });

  it("does not display Logout for guest", () => {
    const html = renderWithLocale(
      <SidebarAccountCard
        user={null}
        isLoggedIn={false}
        isAdmin={false}
        remainingCredits={0}
        openBillingDialog={vi.fn()}
        isCollapsed={false}
      />,
      "zh-CN"
    );

    expect(html).not.toContain("退出");
  });
});

describe("SidebarAccountCard — collapsed state", () => {
  it("renders avatar in collapsed mode", () => {
    const html = renderCard({ isCollapsed: true });

    expect(html).toContain("T");
  });

  it("does not render user name as visible text in collapsed mode", () => {
    const html = renderCard({ isCollapsed: true });

    expect(html).not.toContain(">Test User<");
  });

  it("renders a compact recharge element in collapsed mode", () => {
    const html = renderWithLocale(
      <SidebarAccountCard
        user={mockUser}
        isLoggedIn
        isAdmin={false}
        remainingCredits={790}
        openBillingDialog={vi.fn()}
        isCollapsed
      />,
      "en-US"
    );

    expect(html).not.toContain(">Recharge<");
    expect(html).toContain("aria-label=");
  });

  it("does not overflow horizontally in collapsed state", () => {
    const html = renderCard({ isCollapsed: true });

    expect(html).not.toContain("w-[260px]");
  });
});
