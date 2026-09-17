import { describe, expect, it } from "vitest";
import {
  getWorkspaceActiveKey,
  getWorkspaceMobileNavKey,
  getWorkspacePanelFromPathname,
  getWorkspacePanelUrl,
  isWorkspaceNavItemActive,
  isWorkspaceMobileNavItemActive,
  mobileBottomWorkspaceNavItems,
  workspaceCreationSurfaceNavItems,
  workspaceCreationNavItems,
  workspaceManagementNavItems,
  workspaceServiceNavItems
} from "./workspace-navigation";

describe("workspace navigation config", () => {
  it("maps workspace panels to clean routes", () => {
    expect(getWorkspacePanelUrl(null)).toBe("/");
    expect(getWorkspacePanelUrl("models")).toBe("/models");
    expect(getWorkspacePanelUrl("plans")).toBe("/plans");
    expect(getWorkspacePanelUrl("feedback")).toBe("/feedback");
    expect(getWorkspacePanelUrl("account")).toBe("/account");
    expect(getWorkspacePanelUrl("links")).toBe("/links");
  });

  it("returns exactly one active key for core workspace routes", () => {
    expect(getWorkspaceActiveKey("/image", null)).toBe("image");
    expect(getWorkspaceActiveKey("/image/history", null)).toBe("image");
    expect(getWorkspaceActiveKey("/video", null)).toBe("video");
    expect(getWorkspaceActiveKey("/video/story", null)).toBe("video");
    expect(getWorkspaceActiveKey("/canvas", null)).toBe("canvas");
    expect(getWorkspaceActiveKey("/canvas/project-1", null)).toBe("canvas");
    expect(getWorkspaceActiveKey("/video/workspace", null)).toBe("canvas");
    expect(getWorkspaceActiveKey("/ppt", null)).toBe("ppt");
    expect(getWorkspaceActiveKey("/tasks", null)).toBe("tasks");
    expect(getWorkspaceActiveKey("/assets", null)).toBe("assets");
    expect(getWorkspaceActiveKey("/", null)).toBe("chat");
    expect(getWorkspaceActiveKey("/chat", null)).toBe("chat");
  });

  it("publishes exactly chat, image, video, and canvas as first-level creation entries", () => {
    expect(workspaceCreationNavItems.map(({ key, href }) => ({ key, href }))).toEqual([
      { key: "chat", href: "/" },
      { key: "image", href: "/image" },
      { key: "video", href: "/video" },
      { key: "canvas", href: "/canvas" }
    ]);
    expect(workspaceCreationNavItems.some((item) => item.key === "ppt")).toBe(false);
    expect(workspaceCreationSurfaceNavItems.map(({ key, href }) => ({ key, href }))).toEqual([
      { key: "image", href: "/image" },
      { key: "video", href: "/video" },
      { key: "canvas", href: "/canvas" }
    ]);
  });

  it("publishes exactly one Plans item in the service navigation", () => {
    const plansItems = workspaceServiceNavItems.filter((item) => item.key === "plans");

    expect(plansItems).toHaveLength(1);
    expect(plansItems[0]).toMatchObject({
      key: "plans",
      href: "/plans",
      icon: "plans"
    });
  });

  it("uses panel state before chat route state", () => {
    expect(getWorkspaceActiveKey("/", "models")).toBe("models");
    expect(getWorkspaceActiveKey("/", "plans")).toBe("plans");
    expect(getWorkspaceActiveKey("/", "feedback")).toBe("feedback");
    expect(getWorkspaceActiveKey("/", "account")).toBe("account");
    expect(getWorkspaceActiveKey("/", "links")).toBe("links");
  });

  it("maps clean paths to workspace panels", () => {
    expect(getWorkspacePanelFromPathname("/models")).toBe("models");
    expect(getWorkspacePanelFromPathname("/plans")).toBe("plans");
    expect(getWorkspacePanelFromPathname("/account")).toBe("account");
    expect(getWorkspacePanelFromPathname("/feedback")).toBe("feedback");
    expect(getWorkspacePanelFromPathname("/links")).toBe("links");
    expect(getWorkspacePanelFromPathname("/")).toBeNull();
    expect(getWorkspacePanelFromPathname("/image")).toBeNull();
    expect(getWorkspacePanelFromPathname("/tasks")).toBeNull();
  });

  it("highlights clean panel routes as active keys", () => {
    expect(getWorkspaceActiveKey("/models", null)).toBe("models");
    expect(getWorkspaceActiveKey("/plans", null)).toBe("plans");
    expect(getWorkspaceActiveKey("/account", null)).toBe("account");
    expect(getWorkspaceActiveKey("/feedback", null)).toBe("feedback");
    expect(getWorkspaceActiveKey("/links", null)).toBe("links");
  });

  it("does not highlight Chat together with another workspace entry", () => {
    const chatItem = workspaceCreationNavItems.find((item) => item.key === "chat")!;
    const imageItem = workspaceCreationNavItems.find((item) => item.key === "image")!;
    const tasksItem = workspaceManagementNavItems.find((item) => item.key === "tasks")!;
    const modelsItem = workspaceServiceNavItems.find((item) => item.key === "models")!;
    const plansItem = workspaceServiceNavItems.find((item) => item.key === "plans")!;

    expect(isWorkspaceNavItemActive(chatItem, "/image", null)).toBe(false);
    expect(isWorkspaceNavItemActive(imageItem, "/image", null)).toBe(true);
    expect(isWorkspaceNavItemActive(chatItem, "/tasks", null)).toBe(false);
    expect(isWorkspaceNavItemActive(tasksItem, "/tasks", null)).toBe(true);
    expect(isWorkspaceNavItemActive(chatItem, "/", "models")).toBe(false);
    expect(isWorkspaceNavItemActive(chatItem, "/", "plans")).toBe(false);
    expect(isWorkspaceNavItemActive(modelsItem, "/", "models")).toBe(true);
    expect(isWorkspaceNavItemActive(plansItem, "/plans", null)).toBe(true);
  });

  it("highlights on clean routes via pathname, not activePanel", () => {
    const modelsItem = workspaceServiceNavItems.find((item) => item.key === "models")!;

    expect(isWorkspaceNavItemActive(modelsItem, "/models", null)).toBe(true);
    expect(isWorkspaceNavItemActive(modelsItem, "/models", "plans")).toBe(true);
    expect(isWorkspaceNavItemActive(modelsItem, "/models", "plans")).toBe(true);
  });

  it("highlights feedback on /feedback", () => {
    const feedbackItem = { key: "feedback" as const, panel: "feedback" as const };

    expect(isWorkspaceNavItemActive(feedbackItem, "/feedback", null)).toBe(true);
  });

  it("highlights links on /links", () => {
    const linksItem = { key: "links" as const, panel: "links" as const };

    expect(isWorkspaceNavItemActive(linksItem, "/links", null)).toBe(true);
  });

  it("highlights account on /account", () => {
    const accountItem = { key: "account" as const, panel: "account" as const };

    expect(isWorkspaceNavItemActive(accountItem, "/account", null)).toBe(true);
  });

  it("does not highlight models on /image even when models has panel", () => {
    const modelsItem = workspaceServiceNavItems.find((item) => item.key === "models")!;

    expect(isWorkspaceNavItemActive(modelsItem, "/image", null)).toBe(false);
  });

  it("groups creation routes into one mobile entry", () => {
    expect(getWorkspaceMobileNavKey("/image", null)).toBe("creation");
    expect(getWorkspaceMobileNavKey("/image/history", null)).toBe("creation");
    expect(getWorkspaceMobileNavKey("/video", null)).toBe("creation");
    expect(getWorkspaceMobileNavKey("/canvas", null)).toBe("creation");
    expect(getWorkspaceMobileNavKey("/video/workspace", null)).toBe("creation");
    expect(getWorkspaceMobileNavKey("/ppt", null)).toBe("creation");
  });

  it("groups task and asset detail routes into Works", () => {
    expect(getWorkspaceMobileNavKey("/tasks", null)).toBe("works");
    expect(getWorkspaceMobileNavKey("/tasks/task-1", null)).toBe("works");
    expect(getWorkspaceMobileNavKey("/assets", null)).toBe("works");
    expect(getWorkspaceMobileNavKey("/assets/asset-1", null)).toBe("works");
  });

  it("uses one mobile active matcher for Chat and My", () => {
    const chatItem = mobileBottomWorkspaceNavItems.find(
      (item) => item.key === "chat"
    )!;
    const accountItem = mobileBottomWorkspaceNavItems.find(
      (item) => item.key === "account"
    )!;

    expect(isWorkspaceMobileNavItemActive(chatItem, "/", null)).toBe(true);
    expect(isWorkspaceMobileNavItemActive(chatItem, "/image", null)).toBe(false);
    expect(isWorkspaceMobileNavItemActive(accountItem, "/account", null)).toBe(
      true
    );
  });

  it("keeps Plans out of the four-item mobile bottom navigation", () => {
    expect(mobileBottomWorkspaceNavItems).toHaveLength(4);
    expect(mobileBottomWorkspaceNavItems.some((item) => String(item.key) === "plans")).toBe(false);
    expect(getWorkspaceMobileNavKey("/plans", null)).toBe("account");
  });
});
