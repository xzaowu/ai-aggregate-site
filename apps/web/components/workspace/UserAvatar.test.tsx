import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UserAvatar } from "./UserAvatar";

describe("UserAvatar", () => {
  it("routes a legacy relative avatar URL through the configured API origin", () => {
    const html = renderToStaticMarkup(
      <UserAvatar displayName="Uploaded" seed="user-1" avatarUrl="/generated-assets/avatar.webp" />
    );

    expect(html).toContain('src="/api/generated-assets/avatar.webp"');
    expect(html).toContain('alt="Uploaded"');
  });

  it("renders an initial letter for a logged-in user with a seed", () => {
    const html = renderToStaticMarkup(
      <UserAvatar displayName="Test User" seed="user-1" />
    );

    expect(html).toContain("T");
    expect(html).not.toContain("svg");
  });

  it("renders the first letter of displayName", () => {
    const html = renderToStaticMarkup(
      <UserAvatar displayName="张三" seed="user-2" />
    );

    expect(html).toContain("张");
  });

  it("uses email initial when displayName is missing", () => {
    const html = renderToStaticMarkup(
      <UserAvatar seed="user-3" />
    );

    expect(html).toContain("U");
  });

  it("renders UserRound icon for guest users", () => {
    const html = renderToStaticMarkup(
      <UserAvatar isGuest seed="guest" />
    );

    expect(html).toContain("svg");
    expect(html).not.toContain("U");
  });

  it("returns stable output for the same seed", () => {
    const html1 = renderToStaticMarkup(
      <UserAvatar displayName="Alice" seed="stable-seed" />
    );
    const html2 = renderToStaticMarkup(
      <UserAvatar displayName="Alice" seed="stable-seed" />
    );

    expect(html1).toBe(html2);
  });

  it("produces different colors for different seeds", () => {
    const html1 = renderToStaticMarkup(
      <UserAvatar displayName="Alice" seed="seed-a" />
    );
    const html2 = renderToStaticMarkup(
      <UserAvatar displayName="Bob" seed="seed-b" />
    );

    expect(html1).not.toBe(html2);
  });

  it("renders different size classes for different sizes", () => {
    const sm = renderToStaticMarkup(
      <UserAvatar displayName="A" seed="x" size="sm" />
    );
    const lg = renderToStaticMarkup(
      <UserAvatar displayName="A" seed="x" size="lg" />
    );

    expect(sm).not.toBe(lg);
  });

  it("renders default md size", () => {
    const html = renderToStaticMarkup(
      <UserAvatar displayName="A" seed="x" />
    );

    expect(html).toContain("size-10");
  });

  it("renders small size", () => {
    const html = renderToStaticMarkup(
      <UserAvatar displayName="A" seed="x" size="sm" />
    );

    expect(html).toContain("size-7");
  });

  it("renders large size", () => {
    const html = renderToStaticMarkup(
      <UserAvatar displayName="A" seed="x" size="lg" />
    );

    expect(html).toContain("size-12");
  });

  it("falls back to U when both displayName and seed are empty", () => {
    const html = renderToStaticMarkup(
      <UserAvatar displayName="" seed="" />
    );

    expect(html).toContain("U");
  });

  it("uses seed prefix when displayName is empty", () => {
    const html1 = renderToStaticMarkup(
      <UserAvatar displayName="" seed="test@example.com" />
    );
    const html2 = renderToStaticMarkup(
      <UserAvatar displayName="" seed="empty" />
    );

    expect(html1).toContain("T");
    expect(html2).toContain("E");
  });
});
