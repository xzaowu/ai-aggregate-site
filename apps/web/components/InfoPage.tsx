"use client";

import React from "react";
import { useI18n } from "../lib/i18n/use-i18n";

interface InfoPageSection {
  titleKey?: string;
  paragraphKeys?: string[];
  bulletKeys?: string[];
}

interface InfoPageProps {
  titleKey: string;
  introKey?: string;
  sections: InfoPageSection[];
}

export function InfoPage({ titleKey, introKey, sections }: InfoPageProps) {
  const { t } = useI18n();

  return (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <h1 className="text-3xl font-semibold tracking-normal text-ink">
        {t(titleKey)}
      </h1>
      {introKey ? (
        <p className="mt-4 text-base leading-8 text-ink/70">{t(introKey)}</p>
      ) : null}

      <div className="mt-8 grid gap-5">
        {sections.map((section) => (
          <section
            key={section.titleKey ?? section.paragraphKeys?.[0] ?? section.bulletKeys?.[0]}
            className="rounded-lg border border-ink/10 bg-white p-6 shadow-soft"
          >
            {section.titleKey ? (
              <h2 className="text-lg font-semibold text-ink">
                {t(section.titleKey)}
              </h2>
            ) : null}
            {section.paragraphKeys?.map((paragraphKey) => (
              <p
                key={paragraphKey}
                className="mt-3 text-sm leading-7 text-ink/70 first:mt-0"
              >
                {t(paragraphKey)}
              </p>
            ))}
            {section.bulletKeys ? (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-ink/70">
                {section.bulletKeys.map((bulletKey) => (
                  <li key={bulletKey}>{t(bulletKey)}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
