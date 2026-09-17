"use client";

import { useI18n } from "../lib/i18n/use-i18n";
import { usePublicSettings } from "../lib/use-public-settings";

export function MaintenanceBanner() {
  const { t } = useI18n();
  const settings = usePublicSettings();

  if (!settings?.maintenanceModeEnabled) {
    return null;
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-900">
      {settings.maintenanceMessage?.trim() || t("maintenance.defaultMessage")}
    </div>
  );
}
