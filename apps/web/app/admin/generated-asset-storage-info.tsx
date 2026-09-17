"use client";

import { HardDrive } from "lucide-react";
import React from "react";
import { useI18n } from "../../lib/i18n/use-i18n";

export function GeneratedAssetStorageInfo() {
  const { t } = useI18n();

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2.5">
        <HardDrive className="h-5 w-5 flex-shrink-0 text-slate-500" />
        <h2 className="text-base font-semibold text-slate-800">
          {t("admin.generatedAssetStorage")}
        </h2>
      </div>

      <div className="space-y-3 text-sm text-slate-600">
        <p>{t("admin.generatedAssetStorageDesc")}</p>

        <ul className="list-disc space-y-1.5 pl-5 text-slate-600">
          <li>
            <span className="font-medium text-slate-700">
              {t("admin.generatedAssetStorageDir")}:
            </span>{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
              GENERATED_ASSETS_DIR
            </code>
            {" "}({t("admin.generatedAssetStorageDirDefault")})
          </li>

          <li>
            <span className="font-medium text-slate-700">
              {t("admin.generatedAssetStoragePublicPath")}:
            </span>{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
              GENERATED_ASSETS_PUBLIC_PATH
            </code>
            {" "}({t("admin.generatedAssetStoragePublicPathDefault")})
          </li>
        </ul>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">
            {t("admin.generatedAssetStorageDockerWarning")}
          </p>
          <p className="mt-1.5 text-xs text-amber-700">
            {t("admin.generatedAssetStorageDockerWarningDesc")}
          </p>
          <div className="mt-2 rounded bg-amber-100/70 p-2.5 font-mono text-xs text-amber-800 whitespace-pre-wrap">
            {t("admin.generatedAssetStorageDockerExample")}
          </div>
        </div>

        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3.5">
          <p className="text-xs leading-relaxed text-slate-500">
            {t("admin.generatedAssetStorageReadonly")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {t("admin.generatedAssetStorageFuture")}
          </p>
        </div>
      </div>
    </section>
  );
}