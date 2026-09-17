"use client";

import type { OrderStatus, UsageLogStatus, UserRole } from "@ai-aggregate/shared";
import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction
} from "react";
import { enUS } from "./dictionaries/en-US";
import { zhCN } from "./dictionaries/zh-CN";
import type { Dictionary, Locale, TranslationValues } from "./types";

export const defaultLocale: Locale = "zh-CN";
export const localeStorageKey = "ai-aggregate-locale";

export const supportedLocales: Locale[] = ["zh-CN", "en-US"];

const dictionaries: Record<Locale, Dictionary> = {
  "zh-CN": zhCN,
  "en-US": enUS
};

export interface I18nContextValue {
  locale: Locale;
  setLocale: Dispatch<SetStateAction<Locale>>;
  t: ReturnType<typeof createTranslator>;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

type LocaleStorage = Pick<Storage, "getItem" | "setItem">;

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return supportedLocales.includes(value as Locale);
}

export function readStoredLocale(storage: Pick<Storage, "getItem">): Locale {
  const storedLocale = storage.getItem(localeStorageKey);
  return isSupportedLocale(storedLocale) ? storedLocale : defaultLocale;
}

export function persistLocale(storage: LocaleStorage, locale: Locale) {
  storage.setItem(localeStorageKey, locale);
}

export function createTranslator(locale: Locale) {
  const dictionary = dictionaries[locale];

  return function translate(key: string, values: TranslationValues = {}): string {
    const template = dictionary[key] ?? zhCN[key] ?? key;

    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
      const value = values[name];
      return value === undefined ? match : String(value);
    });
  };
}

export function getOrderStatusLabel(status: OrderStatus, locale: Locale): string {
  return createTranslator(locale)(`status.order.${status}`);
}

export function getUsageLogStatusLabel(
  status: UsageLogStatus,
  locale: Locale
): string {
  return createTranslator(locale)(`status.usage.${status}`);
}

export function getUserRoleLabel(role: UserRole, locale: Locale): string {
  return createTranslator(locale)(`status.role.${role}`);
}

export function formatRawActionLabel(action: string): string {
  return action
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part
    )
    .join(" ");
}

export function getAuditActionLabel(
  action: string,
  t: ReturnType<typeof createTranslator>
): string {
  const key = `admin.auditAction.${action}`;
  const translated = t(key);

  return translated === key ? formatRawActionLabel(action) : translated;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }

  return context;
}
