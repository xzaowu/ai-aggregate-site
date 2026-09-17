"use client";

import type { AiProviderAccountSummary } from "@ai-aggregate/shared";
import React from "react";
import { useI18n } from "../../lib/i18n/use-i18n";

export function AdminModelProviderAccountSelect({
  accounts,
  value,
  className,
  ariaLabel,
  onChange
}: {
  accounts: AiProviderAccountSummary[];
  value: string;
  className: string;
  ariaLabel: string;
  onChange: (providerAccountId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <select
      className={className}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{t("admin.noProviderAccount")}</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name} ({account.providerType})
          {account.enabled ? "" : ` - ${t("admin.disabled")}`}
        </option>
      ))}
    </select>
  );
}
