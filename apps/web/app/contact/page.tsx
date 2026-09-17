"use client";

import React from "react";
import { siteConfig } from "../../lib/site-config";
import { useI18n } from "../../lib/i18n/use-i18n";
import { usePublicSettings } from "../../lib/use-public-settings";

export default function ContactPage() {
  const { t } = useI18n();
  const settings = usePublicSettings();
  const contactEmail =
    settings?.contactEmail?.trim() ||
    siteConfig.contactEmail ||
    t("contact.notConfigured");

  return (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <h1 className="text-3xl font-semibold tracking-normal text-ink">
        {t("contact.title")}
      </h1>
      <div className="mt-8 rounded-lg border border-ink/10 bg-white p-6 shadow-soft">
        <p className="text-sm leading-7 text-ink/70">{t("contact.intro")}</p>
        <div className="mt-6 rounded-md bg-mist p-4">
          <div className="text-xs font-semibold uppercase tracking-normal text-ink/50">
            {t("contact.emailLabel")}
          </div>
          <div className="mt-2 break-all text-base font-semibold text-ink">
            {contactEmail}
          </div>
        </div>
      </div>
    </div>
  );
}
