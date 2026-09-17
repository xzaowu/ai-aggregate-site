"use client";

import { MonitorUp } from "lucide-react";
import React from "react";
import { CreationSurfaceSwitcher } from "../../../components/workspace/CreationSurfaceSwitcher";
import { useOptionalWorkspaceSurface } from "../../../components/workspace/workspace-shell-context";
import { useI18n } from "../../../lib/i18n/use-i18n";
import { CreatorCanvas } from "./creator-canvas";

export function CreatorCanvasPageContent() {
  const { t } = useI18n();
  const workspaceSurface = useOptionalWorkspaceSurface();
  const isDesktop = workspaceSurface === "desktop";

  return (
    <main
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-100 dark:bg-slate-950"
      data-creator-canvas-page="true"
    >
      {isDesktop ? (
        <CreatorCanvas />
      ) : (
        <>
          <header className="relative z-30 shrink-0 bg-white px-3 pb-2 pt-3 dark:bg-slate-950">
            <CreationSurfaceSwitcher activeSurface="canvas" />
          </header>
          <section
            className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto px-5 py-10"
            data-creator-canvas-mobile-fence="true"
          >
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                <MonitorUp className="size-6" aria-hidden="true" />
              </span>
              <h1 className="mt-4 text-lg font-semibold text-slate-950 dark:text-slate-100">
                {t("creator.canvas.mobileTitle")}
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {t("creator.canvas.mobileDescription")}
              </p>
              <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300">
                {t("creator.canvas.workspaceSubtitle")}
              </p>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
