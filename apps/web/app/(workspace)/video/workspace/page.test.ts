import { describe, expect, it, vi } from "vitest";
import VideoWorkspacePage from "./page";

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: redirectMock
}));

describe("legacy video workspace route", () => {
  it("redirects to the canonical Creator Canvas route", () => {
    VideoWorkspacePage();

    expect(redirectMock).toHaveBeenCalledOnce();
    expect(redirectMock).toHaveBeenCalledWith("/canvas");
  });
});
