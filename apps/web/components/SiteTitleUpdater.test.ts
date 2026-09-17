import { afterEach, describe, expect, it, vi } from "vitest";
import { updateDynamicFavicon } from "./SiteTitleUpdater";

const originalDocument = globalThis.document;

function installFakeDocument() {
  const appended: Array<{
    href: string;
    rel: string;
    remove: ReturnType<typeof vi.fn>;
  }> = [];

  const fakeDocument = {
    createElement: vi.fn(() => ({
      href: "",
      rel: "",
      remove: vi.fn()
    })),
    head: {
      appendChild: vi.fn((node: (typeof appended)[number]) => {
        appended.push(node);
        return node;
      })
    }
  };

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: fakeDocument
  });

  return { appended, fakeDocument };
}

afterEach(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument
  });
});

describe("updateDynamicFavicon", () => {
  it("appends a dynamic favicon link when a public favicon URL is configured", () => {
    const { appended, fakeDocument } = installFakeDocument();

    const link = updateDynamicFavicon("https://example.com/favicon.ico", null);

    expect(fakeDocument.createElement).toHaveBeenCalledWith("link");
    expect(fakeDocument.head.appendChild).toHaveBeenCalledTimes(1);
    expect(appended[0]).toBe(link);
    expect(link?.rel).toBe("icon");
    expect(link?.href).toBe("https://example.com/favicon.ico");
  });

  it("removes the previous dynamic favicon and does not append one when cleared", () => {
    const { fakeDocument } = installFakeDocument();
    const previous = {
      href: "https://example.com/favicon.ico",
      rel: "icon",
      remove: vi.fn()
    };

    const next = updateDynamicFavicon(null, previous as unknown as HTMLLinkElement);

    expect(previous.remove).toHaveBeenCalledTimes(1);
    expect(fakeDocument.head.appendChild).not.toHaveBeenCalled();
    expect(next).toBeNull();
  });
});
