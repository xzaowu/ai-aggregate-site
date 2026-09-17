// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminStorageSubscriptions from "./admin-storage-subscriptions";

const testState = vi.hoisted(() => ({
  isAdmin: true,
  locale: "zh-CN",
  t: (key: string) => key
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./admin-auth-context", () => ({
  useAdminAuth: () => ({
    token: testState.isAdmin ? "admin-token" : "user-token",
    user: null,
    isLoggedIn: true,
    isAdmin: testState.isAdmin,
    logout: vi.fn(),
    setAuthUser: vi.fn()
  })
}));

vi.mock("../../lib/i18n/use-i18n", () => ({
  useI18n: () => ({
    locale: testState.locale,
    setLocale: vi.fn(),
    t: testState.t
  })
}));

type FetchCall = [RequestInfo | URL, RequestInit | undefined];

const users = [
  {
    userId: "user-inactive",
    userEmail: "inactive@example.test",
    userName: "未开通用户",
    status: "INACTIVE" as const,
    priceCredits: 100,
    durationDays: 30,
    autoRenewEnabled: false,
    startsAt: null,
    expiresAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  },
  {
    userId: "user-active",
    userEmail: "active@example.test",
    userName: "已开通用户",
    status: "ACTIVE" as const,
    priceCredits: 100,
    durationDays: 30,
    autoRenewEnabled: true,
    startsAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-07-31T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  },
  {
    userId: "user-expired",
    userEmail: "expired@example.test",
    userName: "已过期用户",
    status: "EXPIRED" as const,
    priceCredits: 100,
    durationDays: 30,
    autoRenewEnabled: false,
    startsAt: "2026-05-01T00:00:00.000Z",
    expiresAt: "2026-05-31T00:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z"
  }
];

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function pageResponse(items = users, page = 1, pageSize = 20, total = items.length, totalPages = 1) {
  return jsonResponse({ items, page, pageSize, total, totalPages });
}

function urlOf(input: RequestInfo | URL) {
  return new URL(String(input), "http://localhost");
}

function listCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input]) => urlOf(input).pathname.endsWith("/admin/storage-subscriptions"));
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AdminStorageSubscriptions", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    testState.isAdmin = true;
    testState.locale = "zh-CN";
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    vi.restoreAllMocks();
  });

  async function mount(fetchImpl: (...args: FetchCall) => Promise<unknown>) {
    const fetchMock = vi.fn(fetchImpl);
    vi.stubGlobal("fetch", fetchMock);
    root = createRoot(host);
    await act(async () => {
      root.render(<AdminStorageSubscriptions />);
      await Promise.resolve();
    });
    return fetchMock;
  }

  async function mountReady(items = users, total = items.length, totalPages = 1) {
    return mount(async () => pageResponse(items, 1, 20, total, totalPages));
  }

  function findButton(label: string) {
    return Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes(label)
    );
  }

  function editFirstUser() {
    const edit = findButton("编辑");
    expect(edit).toBeTruthy();
    edit?.click();
  }

  function selectAction(value: string) {
    const select = host.querySelector<HTMLSelectElement>('[role="dialog"] select');
    expect(select).toBeTruthy();
    if (!select) return;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("shows loading before the list request resolves", async () => {
    let resolveRequest!: (value: unknown) => void;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => request));
    root = createRoot(host);
    root.render(<AdminStorageSubscriptions />);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(host.textContent).toContain("加载中");
    resolveRequest(pageResponse());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });

  it("renders users, emails, all status badges, and dark-mode classes after success", async () => {
    await mountReady();
    await settle();

    expect(host.textContent).toContain("未开通用户");
    expect(host.textContent).toContain("inactive@example.test");
    expect(host.textContent).toContain("已开通");
    expect(host.textContent).toContain("已过期");
    expect(host.querySelector(".dark\\:bg-emerald-950\\/30")).toBeTruthy();
    expect(host.querySelector(".dark\\:bg-orange-950\\/30")).toBeTruthy();
    expect(host.querySelector(".dark\\:bg-slate-800")).toBeTruthy();
  });

  it("renders the empty state", async () => {
    await mountReady([], 0, 1);
    await settle();
    expect(host.textContent).toContain("暂无数据");
  });

  it("renders an error and retries the list request", async () => {
    let calls = 0;
    const fetchMock = await mount(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ message: "failed" }, 500) : pageResponse();
    });
    await settle();
    expect(host.textContent).toContain("加载失败");

    findButton("刷新")?.click();
    await settle();
    expect(calls).toBe(2);
    expect(host.textContent).toContain("未开通用户");
    expect(listCalls(fetchMock)).toHaveLength(2);
  });

  it("sends the search query for email and name searches", async () => {
    const fetchMock = await mountReady();
    await settle();
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "active@example.test");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "已开通用户");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    const calls = listCalls(fetchMock);
    const initialCall = calls[0];
    expect(initialCall).toBeDefined();
    if (!initialCall) return;
    expect(urlOf(initialCall[0]).searchParams.get("page")).toBe("1");
    expect(urlOf(initialCall[0]).searchParams.get("pageSize")).toBe("20");
    const emailSearchCall = calls.at(-2);
    const nameSearchCall = calls.at(-1);
    expect(emailSearchCall).toBeDefined();
    expect(nameSearchCall).toBeDefined();
    if (!emailSearchCall || !nameSearchCall) return;
    expect(urlOf(emailSearchCall[0]).searchParams.get("q")).toBe("active@example.test");
    expect(urlOf(nameSearchCall[0]).searchParams.get("q")).toBe("已开通用户");
  });

  it("sends ALL, ACTIVE, INACTIVE, and EXPIRED filter parameters", async () => {
    const fetchMock = await mountReady();
    await settle();
    const select = host.querySelector<HTMLSelectElement>("select")!;

    for (const value of ["ACTIVE", "INACTIVE", "EXPIRED", "ALL"]) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
    }

    const calls = listCalls(fetchMock);
    expect(urlOf(calls.at(-4)![0]).searchParams.get("status")).toBe("ACTIVE");
    expect(urlOf(calls.at(-3)![0]).searchParams.get("status")).toBe("INACTIVE");
    expect(urlOf(calls.at(-2)![0]).searchParams.get("status")).toBe("EXPIRED");
    expect(urlOf(calls.at(-1)![0]).searchParams.has("status")).toBe(false);
  });

  it("supports page sizes 10/20/50/100 and resets to page 1", async () => {
    const fetchMock = await mountReady(users, 200, 10);
    await settle();
    const pageSize = host.querySelectorAll<HTMLSelectElement>("select").item(1);
    expect(Array.from(pageSize.options, (option) => option.value)).toEqual(["10", "20", "50", "100"]);
    pageSize.value = "50";
    pageSize.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    const last = listCalls(fetchMock).at(-1);
    expect(urlOf(last![0]).searchParams.get("page")).toBe("1");
    expect(urlOf(last![0]).searchParams.get("pageSize")).toBe("50");
  });

  it("requests the previous and next pages with the active page size", async () => {
    const fetchMock = await mount(async (_input, init) => {
      const url = urlOf(_input);
      const page = Number(url.searchParams.get("page"));
      return pageResponse(users, page, 20, 60, 3);
    });
    await settle();
    expect(host.textContent).toContain("1 / 3");

    host.querySelector<HTMLButtonElement>('button[aria-label="下一页"]')?.click();
    await settle();
    expect(urlOf(listCalls(fetchMock).at(-1)![0]).searchParams.get("page")).toBe("2");
    host.querySelector<HTMLButtonElement>('button[aria-label="上一页"]')?.click();
    await settle();
    expect(urlOf(listCalls(fetchMock).at(-1)![0]).searchParams.get("page")).toBe("1");
  });

  it("submits ACTIVATE once, disables the button while pending, and reloads the list", async () => {
    let resolvePatch!: (value: unknown) => void;
    let patchCalls = 0;
    const fetchMock = await mount(async (input, init) => {
      if (init?.method === "PATCH") {
        patchCalls += 1;
        return new Promise((resolve) => { resolvePatch = resolve; });
      }
      return pageResponse();
    });
    await settle();
    editFirstUser();
    await settle();
    selectAction("ACTIVATE");
    await settle();
    findButton("确定")?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(patchCalls).toBe(1);
    expect(findButton("提交中")).toBeTruthy();
    expect(findButton("提交中")?.disabled).toBe(true);
    findButton("提交中")?.click();
    expect(patchCalls).toBe(1);
    resolvePatch(jsonResponse({}));
    await settle();
    expect(patchCalls).toBe(1);
    expect(listCalls(fetchMock).length).toBeGreaterThan(1);
  });

  it("submits EXTEND with the selected duration", async () => {
    const fetchMock = await mount(async (input, init) => init?.method === "PATCH" ? jsonResponse({}) : pageResponse());
    await settle();
    editFirstUser();
    await settle();
    selectAction("EXTEND");
    await settle();
    const duration = host.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(duration, "45");
      duration.dispatchEvent(new Event("input", { bubbles: true }));
      duration.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    findButton("确定")?.click();
    await settle();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patch).toBeDefined();
    if (!patch) return;
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ action: "EXTEND", durationDays: 45 });
  });

  it("requires confirmation before DEACTIVATE and then sends one PATCH", async () => {
    const fetchMock = await mount(async (input, init) => init?.method === "PATCH" ? jsonResponse({}) : pageResponse());
    await settle();
    editFirstUser();
    await settle();
    selectAction("DEACTIVATE");
    await settle();
    findButton("确定")?.click();
    await settle();
    expect(host.textContent).toContain("确认停用");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
    findButton("确认停用")?.click();
    await settle();
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(1);
    const firstPatch = patches[0];
    expect(firstPatch).toBeDefined();
    if (!firstPatch) return;
    expect(JSON.parse(String(firstPatch[1]?.body))).toEqual({ action: "DEACTIVATE" });
  });

  it.each([
    [true, "true"],
    [false, "false"]
  ])("submits SET_AUTO_RENEW with enabled=%s", async (enabled, expected) => {
    const fetchMock = await mount(async (input, init) => init?.method === "PATCH" ? jsonResponse({}) : pageResponse());
    await settle();
    editFirstUser();
    await settle();
    selectAction("SET_AUTO_RENEW");
    await settle();
    const checkbox = host.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!;
    if (checkbox.checked !== enabled) checkbox.click();
    findButton("确定")?.click();
    await settle();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ action: "SET_AUTO_RENEW", enabled: JSON.parse(expected) });
  });

  it("shows an Admin Toast when an operation fails", async () => {
    await mount(async (input, init) => init?.method === "PATCH" ? jsonResponse({ message: "操作失败" }, 400) : pageResponse());
    await settle();
    editFirstUser();
    await settle();
    selectAction("ACTIVATE");
    await settle();
    findButton("确定")?.click();
    await settle();
    expect(host.querySelector('[aria-label="Notifications"]')).toBeTruthy();
    expect(host.textContent).toContain("操作失败");
  });

  it("does not show management controls for a normal user", async () => {
    testState.isAdmin = false;
    await mount(async () => pageResponse());
    await settle();
    expect(host.textContent).toContain("无权访问");
    expect(host.querySelector('input[type="search"]')).toBeNull();
    expect(findButton("编辑")).toBeUndefined();
  });

  it("does not show management controls after a 403 response", async () => {
    await mount(async () => jsonResponse({ message: "forbidden" }, 403));
    await settle();
    expect(host.textContent).toContain("无权访问");
    expect(host.querySelector('input[type="search"]')).toBeNull();
    expect(findButton("编辑")).toBeUndefined();
  });

  it("renders the required Chinese and English labels", async () => {
    await mountReady();
    await settle();
    expect(host.textContent).toContain("存储包管理");
    editFirstUser();
    await settle();
    expect(host.textContent).toContain("选择操作");

    testState.locale = "en-US";
    await act(async () => root.unmount());
    root = createRoot(host);
    root.render(<AdminStorageSubscriptions />);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await settle();
    const englishEdit = findButton("Edit");
    expect(englishEdit).toBeTruthy();
    englishEdit?.click();
    await settle();
    expect(host.textContent).toContain("Storage packages");
    expect(host.textContent).toContain("Select action");
  });
});
