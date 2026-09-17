"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Locale } from "./types";
import {
  createTranslator,
  defaultLocale,
  I18nContext,
  persistLocale,
  readStoredLocale
} from "./use-i18n";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  useEffect(() => {
    setLocaleState(readStoredLocale(window.localStorage));
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const contextValue = useMemo(
    () => ({
      locale,
      setLocale: (nextLocale: Locale | ((current: Locale) => Locale)) => {
        setLocaleState((current) => {
          const resolvedLocale =
            typeof nextLocale === "function" ? nextLocale(current) : nextLocale;
          persistLocale(window.localStorage, resolvedLocale);
          return resolvedLocale;
        });
      },
      t: createTranslator(locale)
    }),
    [locale]
  );

  return (
    <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>
  );
}
