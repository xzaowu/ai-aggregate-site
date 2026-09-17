import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nContext, createTranslator } from "../../lib/i18n/use-i18n";
import type { Locale } from "../../lib/i18n/types";
import {
  AdminContactSettings,
  type ContactFormState
} from "./admin-contact-settings";

const form: ContactFormState = {
  contactDescription: "Get in touch with us.",
  contactEmail: "support@example.com",
  contactWechat: "wechat_id",
  contactPublicAccount: "public_account",
  contactCommunityUrl: "https://community.example.com",
  contactQrImageUrl: "https://example.com/qr.png",
  contactNotes: "Office hours: 9-5",
  contactExternalLinks: [
    { label: "Discord", url: "https://discord.gg/example" }
  ]
};

function renderWithLocale(
  locale: Locale,
  props: Partial<React.ComponentProps<typeof AdminContactSettings>> = {}
) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: createTranslator(locale)
      }}
    >
      <AdminContactSettings
        form={form}
        saving={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        {...props}
      />
    </I18nContext.Provider>
  );
}

describe("admin contact settings", () => {
  it("renders all contact fields with form values", () => {
    const html = renderWithLocale("en-US");

    expect(html).toContain("Get in touch with us.");
    expect(html).toContain("support@example.com");
    expect(html).toContain("wechat_id");
    expect(html).toContain("public_account");
    expect(html).toContain("https://community.example.com");
    expect(html).toContain("https://example.com/qr.png");
    expect(html).toContain("Office hours: 9-5");
  });

  it("renders external links section with link data", () => {
    const html = renderWithLocale("en-US");

    expect(html).toContain("Discord");
    expect(html).toContain("https://discord.gg/example");
  });

  it("renders add link button when links are empty", () => {
    const html = renderWithLocale("en-US", {
      form: { ...form, contactExternalLinks: [] }
    });
    expect(html).toContain("Add link");
  });

  it("renders remove link button when links exist", () => {
    const html = renderWithLocale("en-US");

    expect(html).toContain("Remove link");
  });

  it("renders save button", () => {
    const html = renderWithLocale("en-US");

    expect(html).toContain("Save contact settings");
  });

  it("shows saving state when saving is true", () => {
    const html = renderWithLocale("en-US", { saving: true });

    expect(html).toContain("disabled");
  });

  it("renders section title", () => {
    const html = renderWithLocale("en-US");

    expect(html).toContain("Contact &amp; Community Settings");
  });
});
