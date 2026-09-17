import { describe, expect, it } from "vitest";
import { hidesGlobalWorkspaceChrome } from "./workspace-routes";

describe("workspace route chrome rules", () => {
  it.each(["/", "/chat", "/image", "/video", "/canvas", "/ppt", "/tasks", "/assets", "/admin"])(
    "hides the traditional top navigation for %s",
    (pathname) => {
      expect(hidesGlobalWorkspaceChrome(pathname)).toBe(true);
    }
  );

  it.each(["/canvas/project_1", "/video/workspace", "/tasks/task_1", "/assets/asset_1", "/admin/settings"])(
    "hides the traditional top navigation for workspace detail route %s",
    (pathname) => {
      expect(hidesGlobalWorkspaceChrome(pathname)).toBe(true);
    }
  );

  it.each(["/about", "/pricing", "/help"])(
    "keeps public chrome rules unchanged for %s",
    (pathname) => {
      expect(hidesGlobalWorkspaceChrome(pathname)).toBe(false);
    }
  );
});
