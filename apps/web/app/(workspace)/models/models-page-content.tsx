"use client";

import React, {
  useCallback,
  useEffect,
  useState,
  type ReactNode
} from "react";
import { useRouter } from "next/navigation";
import {
  chatModelHandoffStorageKey,
  ModelsPanel
} from "../../../components/workspace/ChatWorkspace";
import { MobilePageHeader } from "../../../components/workspace/MobilePageHeader";
import { useI18n } from "../../../lib/i18n/use-i18n";
import { apiUrl } from "../../../lib/site-config";
import { useWorkspaceShellContext } from "../../../components/workspace/workspace-shell-context";
import type { AiModelSummary } from "@ai-aggregate/shared";

const imageModelHandoffStorageKey =
  "ai-aggregate:image-selected-model-handoff:v1";

interface QuotaResponse {
  remainingCredits: number;
}

function ModelLibraryPanelShell({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-slate-900">
      <div className="hidden shrink-0 border-b border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur sm:px-6 sm:py-3 md:block dark:border-slate-700 dark:bg-slate-900/95">
        <h2 className="min-w-0 truncate text-base font-semibold text-slate-950 sm:text-lg dark:text-slate-100">
          {title}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950">
        {children}
      </div>
    </section>
  );
}

export default function ModelsPageContent() {
  const router = useRouter();
  const { t } = useI18n();
  const workspaceShell = useWorkspaceShellContext();
  const { shell } = workspaceShell;
  const token = shell.token;

  const [models, setModels] = useState<AiModelSummary[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const modelsResponse = await fetch(apiUrl("/models"));
        if (!modelsResponse.ok) {
          throw new Error(`Failed to load models (${modelsResponse.status})`);
        }
        const modelData = (await modelsResponse.json()) as {
          models?: AiModelSummary[];
        };

        if (!isMounted) return;

        const enabledModels = (modelData.models ?? []).filter(
          (model) => model.enabled
        );
        setModels(enabledModels);
        if (enabledModels.length > 0 && !selectedModel) {
          setSelectedModel(enabledModels[0]!.modelId);
        }

        if (token) {
          try {
            const quotaResponse = await fetch(apiUrl("/quota/me"), {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (quotaResponse.ok) {
              await quotaResponse.json() as QuotaResponse;
            }
          } catch {
            // quota fetch is optional for validation
          }
        }

        setModelsLoaded(true);
      } catch {
        if (isMounted) {
          setModelsLoaded(true);
        }
      }
    }

    void load();
    return () => {
      isMounted = false;
    };
  }, [selectedModel, token]);

  const handleSelectModel = useCallback(
    (modelId: string) => {
      setSelectedModel(modelId);
      try {
        window.sessionStorage.setItem(
          chatModelHandoffStorageKey,
          JSON.stringify({ modelId, createdAt: Date.now() })
        );
      } catch {
        // Navigation remains safe if browser storage is unavailable.
      }
      router.push("/");
    },
    [router]
  );

  const handleOpenImageModel = useCallback(
    (modelId: string) => {
      try {
        window.sessionStorage.setItem(
          imageModelHandoffStorageKey,
          JSON.stringify({
            modelId,
            createdAt: Date.now()
          })
        );
      } catch {
        // Browser storage can be unavailable; navigation still works.
      }
      router.push("/image");
    },
    [router]
  );

  return (
    <>
      <MobilePageHeader title={t("workspace.models")} backHref="/account" />
      <ModelLibraryPanelShell title={t("workspace.models")}>
        <ModelsPanel
          models={models}
          modelsLoaded={modelsLoaded}
          selectedModel={selectedModel}
          onSelectModel={handleSelectModel}
          onOpenImageModel={handleOpenImageModel}
        />
      </ModelLibraryPanelShell>
    </>
  );
}
