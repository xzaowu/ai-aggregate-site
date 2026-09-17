"use client";

import type {
  AiModelRouteSummary,
  AdminAiModelSummary,
  AiProviderAccountSummary,
  ModelCapability,
  ModelDisplaySurface,
  ModelImageInvokeMode,
  ModelImageOutputParser,
  ModelProvider
} from "@ai-aggregate/shared";
import { Pencil, Plus } from "lucide-react";
import React, { useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import {
  AdminDataTable,
  AdminSection,
  AdminSectionHeader,
  AdminStatusBadge,
  AdminTableCell,
  AdminTableEmptyRow,
  AdminTableHeadCell
} from "./admin-layout";
import {
  AdminModelDetailDrawer,
  type ModelRouteFormState
} from "./admin-model-detail-drawer";

export interface ModelFormState {
  name: string;
  displayName: string;
  modelId: string;
  provider: ModelProvider;
  providerAccountId: string;
  capability: ModelCapability;
  displaySurfaces: ModelDisplaySurface[];
  imageInvokeMode: ModelImageInvokeMode;
  imageOutputParser: ModelImageOutputParser;
  maxReferenceImages: string;
  group: string;
  tagsText: string;
  shortDescription: string;
  isRecommended: boolean;
  enabled: boolean;
  allowGuest: boolean;
  creditCost: string;
  sortOrder: string;
  iconUrl: string;
  iconText: string;
  iconColor: string;
}

type DrawerState =
  | { mode: "create" }
  | { mode: "edit"; modelId: string }
  | null;

interface AdminModelsSectionProps {
  models: AdminAiModelSummary[];
  providerAccounts: AiProviderAccountSummary[];
  newModel: ModelFormState;
  creatingModel: boolean;
  modelInputs: Record<string, ModelFormState>;
  modelRouteInputs: Record<string, ModelRouteFormState>;
  savingModelId: string | null;
  savingModelRouteId: string | null;
  emptyModelRouteForm: ModelRouteFormState;
  modelProviders: ModelProvider[];
  modelCapabilityOptions: ModelCapability[];
  inputClass: string;
  checkboxClass: string;
  primaryButtonClass: string;
  iconButtonClass: string;
  toggleInlineClass: string;
  initialDrawerState?: DrawerState;
  onNewModelChange: React.Dispatch<React.SetStateAction<ModelFormState>>;
  onModelInputsChange: React.Dispatch<
    React.SetStateAction<Record<string, ModelFormState>>
  >;
  onModelRouteInputsChange: React.Dispatch<
    React.SetStateAction<Record<string, ModelRouteFormState>>
  >;
  onCreateModel: () => Promise<AdminAiModelSummary | null>;
  onUpdateModel: (model: AdminAiModelSummary) => void;
  onDisableModel: (model: AdminAiModelSummary) => void;
  onDeleteModel: (model: AdminAiModelSummary) => void;
  onCreateModelRoute: (model: AdminAiModelSummary) => void;
  onUpdateModelRoute: (
    model: AdminAiModelSummary,
    route: AiModelRouteSummary,
    patch: Partial<
      Pick<AiModelRouteSummary, "providerId" | "upstreamModel" | "priority" | "enabled">
    >
  ) => void;
  onDisableModelRoute: (model: AdminAiModelSummary, route: AiModelRouteSummary) => void;
  onCopyModelId: (modelId: string) => void;
}

export function AdminModelsSection({
  models,
  providerAccounts,
  newModel,
  creatingModel,
  modelInputs,
  modelRouteInputs,
  savingModelId,
  savingModelRouteId,
  emptyModelRouteForm,
  modelProviders,
  modelCapabilityOptions,
  inputClass,
  checkboxClass,
  primaryButtonClass,
  iconButtonClass,
  toggleInlineClass,
  initialDrawerState = null,
  onNewModelChange,
  onModelInputsChange,
  onModelRouteInputsChange,
  onCreateModel,
  onUpdateModel,
  onDisableModel,
  onDeleteModel,
  onCreateModelRoute,
  onUpdateModelRoute,
  onDisableModelRoute,
  onCopyModelId
}: AdminModelsSectionProps) {
  const { t } = useI18n();
  const [drawerState, setDrawerState] = useState<DrawerState>(initialDrawerState);
  const selectedModel = useMemo(
    () =>
      drawerState?.mode === "edit"
        ? models.find((model) => model.id === drawerState.modelId) ?? null
        : null,
    [drawerState, models]
  );
  const selectedForm = selectedModel
    ? modelInputs[selectedModel.id] ?? modelToForm(selectedModel)
    : null;
  const selectedRoutes = selectedModel
    ? Array.isArray(selectedModel.routes)
      ? (selectedModel.routes as AiModelRouteSummary[])
      : []
    : [];
  const selectedRouteForm = selectedModel
    ? modelRouteInputs[selectedModel.id] ?? {
        ...emptyModelRouteForm,
        providerAccountId: providerAccounts[0]?.id ?? ""
      }
    : emptyModelRouteForm;

  async function createModelAndContinue() {
    const createdModel = await onCreateModel();
    if (createdModel) {
      setDrawerState((current) =>
        current?.mode === "create"
          ? { mode: "edit", modelId: createdModel.id }
          : current
      );
    }
  }

  return (
    <AdminSection>
      <AdminSectionHeader
        description={t("admin.modelList")}
        title={t("admin.modelBilling")}
      >
        <button
          className={primaryButtonClass}
          type="button"
          onClick={() => setDrawerState({ mode: "create" })}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          {t("admin.addModel")}
        </button>
      </AdminSectionHeader>

      <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2">
        <details className="group">
          <summary className="cursor-pointer list-none text-xs font-semibold text-slate-700 marker:hidden">
            {t("admin.modelListHelp")}
          </summary>
          <div className="mt-2 grid gap-2 text-xs leading-5 text-slate-500 md:grid-cols-2 xl:grid-cols-3">
            <FieldHelp label={t("admin.realModelId")} help={t("admin.realModelIdHelp")} />
            <FieldHelp label={t("admin.providerAccount")} help={t("admin.modelProviderAccountHelp")} />
            <FieldHelp label={t("admin.routePriority")} help={t("admin.routePriorityHelp")} />
          </div>
        </details>
      </div>

      <AdminDataTable>
        <table
          className="w-full min-w-[620px] border-separate border-spacing-0 text-left text-sm lg:min-w-[1180px]"
          data-admin-data-surface="models"
        >
          <thead className="bg-slate-50">
            <tr>
              <AdminTableHeadCell>{t("admin.modelName")}</AdminTableHeadCell>
              <AdminTableHeadCell priority="secondary">
                {t("admin.customDisplayName")}
              </AdminTableHeadCell>
              <AdminTableHeadCell priority="tertiary">
                {t("admin.realModelId")}
              </AdminTableHeadCell>
              <AdminTableHeadCell priority="secondary">
                {t("admin.canonicalId")}
              </AdminTableHeadCell>
              <AdminTableHeadCell priority="tertiary">
                {t("admin.modelCompatibilityProvider")}
              </AdminTableHeadCell>
              <AdminTableHeadCell priority="tertiary">
                {t("admin.modelDisplaySurfaces")}
              </AdminTableHeadCell>
              <AdminTableHeadCell priority="tertiary">
                {t("admin.modelImageRuntimeConfig")}
              </AdminTableHeadCell>
              <AdminTableHeadCell priority="secondary">
                {t("admin.modelGroup")}
              </AdminTableHeadCell>
              <AdminTableHeadCell>{t("admin.enabled")}</AdminTableHeadCell>
              <AdminTableHeadCell priority="secondary">
                {t("admin.allowGuestUsage")}
              </AdminTableHeadCell>
              <AdminTableHeadCell priority="secondary">
                {t("admin.recommendedModel")}
              </AdminTableHeadCell>
              <AdminTableHeadCell>{t("admin.enabledRoutes")}</AdminTableHeadCell>
              <AdminTableHeadCell>{t("admin.actions")}</AdminTableHeadCell>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {models.length === 0 ? (
              <AdminTableEmptyRow colSpan={13}>{t("admin.noModels")}</AdminTableEmptyRow>
            ) : (
              models.map((model) => {
                const form = modelInputs[model.id] ?? modelToForm(model);
                const routes = Array.isArray(model.routes)
                  ? (model.routes as AiModelRouteSummary[])
                  : [];
                const enabledRoutes = routes.filter((route) => route.enabled).length;

                return (
                  <tr
                    key={model.id}
                    className="bg-white align-middle transition-colors hover:bg-slate-50"
                    data-admin-model-row
                    data-admin-table-row="true"
                  >
                    <AdminTableCell className="font-semibold text-slate-950">
                      <div className="flex min-w-0 items-center gap-2">
                        <ModelIcon
                          color={form.iconColor}
                          fallback={form.displayName || form.name || model.name}
                          text={form.iconText}
                        />
                        <span className="truncate">{form.name || model.name}</span>
                      </div>
                    </AdminTableCell>
                    <AdminTableCell priority="secondary" className="text-slate-700">
                      {form.displayName || "-"}
                    </AdminTableCell>
                    <AdminTableCell priority="tertiary">
                      <code className="block max-w-[220px] truncate font-mono text-xs text-slate-700">
                        {form.modelId}
                      </code>
                    </AdminTableCell>
                    <AdminTableCell priority="secondary">
                      <code className="font-mono text-xs text-slate-500">{model.slug}</code>
                    </AdminTableCell>
                    <AdminTableCell priority="tertiary" className="text-slate-700">
                      {form.provider}
                    </AdminTableCell>
                    <AdminTableCell priority="tertiary" className="text-slate-700">
                      {formatDisplaySurfaces(form.displaySurfaces, t)}
                    </AdminTableCell>
                    <AdminTableCell priority="tertiary" className="text-xs text-slate-600">
                      <span className="block whitespace-nowrap">
                        {t(`admin.modelImageInvokeMode.${form.imageInvokeMode}`)}
                      </span>
                      <span className="block whitespace-nowrap text-slate-400">
                        {t(`admin.modelImageOutputParser.${form.imageOutputParser}`)}
                      </span>
                    </AdminTableCell>
                    <AdminTableCell priority="secondary" className="text-slate-700">
                      {form.group || "-"}
                    </AdminTableCell>
                    <AdminTableCell>
                      <AdminStatusBadge tone={form.enabled ? "emerald" : "slate"}>
                        {form.enabled ? t("admin.enabled") : t("admin.disabled")}
                      </AdminStatusBadge>
                    </AdminTableCell>
                    <AdminTableCell priority="secondary">
                      <AdminStatusBadge tone={form.allowGuest ? "indigo" : "slate"}>
                        {form.allowGuest ? t("admin.enabled") : t("admin.disabled")}
                      </AdminStatusBadge>
                    </AdminTableCell>
                    <AdminTableCell priority="secondary">
                      <AdminStatusBadge tone={form.isRecommended ? "amber" : "slate"}>
                        {form.isRecommended ? t("admin.enabled") : t("admin.disabled")}
                      </AdminStatusBadge>
                    </AdminTableCell>
                    <AdminTableCell className="text-slate-700">
                      <span className="font-semibold text-slate-950">{enabledRoutes}</span>
                      <span className="text-slate-400"> / {routes.length}</span>
                    </AdminTableCell>
                    <AdminTableCell>
                      <button
                        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700"
                        type="button"
                        onClick={() => setDrawerState({ mode: "edit", modelId: model.id })}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                        {t("admin.details")}
                      </button>
                    </AdminTableCell>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </AdminDataTable>

      <AdminModelDetailDrawer
        checkboxClass={checkboxClass}
        creatingModel={creatingModel}
        drawerMode={drawerState?.mode ?? null}
        form={selectedForm}
        iconButtonClass={iconButtonClass}
        inputClass={inputClass}
        model={selectedModel}
        modelCapabilityOptions={modelCapabilityOptions}
        modelProviders={modelProviders}
        newModel={newModel}
        primaryButtonClass={primaryButtonClass}
        providerAccounts={providerAccounts}
        routeForm={selectedRouteForm}
        routes={selectedRoutes}
        savingModelId={savingModelId}
        savingModelRouteId={savingModelRouteId}
        toggleInlineClass={toggleInlineClass}
        onClose={() => setDrawerState(null)}
        onCopyModelId={onCopyModelId}
        onCreateModel={createModelAndContinue}
        onCreateRoute={onCreateModelRoute}
        onDeleteModel={onDeleteModel}
        onDisableModel={onDisableModel}
        onDisableRoute={onDisableModelRoute}
        onModelInputsChange={onModelInputsChange}
        onNewModelChange={onNewModelChange}
        onRouteFormChange={(nextForm) => {
          if (!selectedModel) return;
          onModelRouteInputsChange((current) => ({
            ...current,
            [selectedModel.id]: nextForm
          }));
        }}
        onUpdateModel={onUpdateModel}
        onUpdateRoute={onUpdateModelRoute}
      />
    </AdminSection>
  );
}

function modelToForm(model: AdminAiModelSummary): ModelFormState {
  return {
    name: model.name,
    displayName: model.displayName ?? "",
    modelId: model.modelId,
    provider: model.provider,
    providerAccountId: model.providerAccountId ?? "",
    capability: model.capability ?? "chat",
    displaySurfaces: model.displaySurfaces ?? ["chat"],
    imageInvokeMode: model.imageInvokeMode ?? "native-image",
    imageOutputParser: model.imageOutputParser ?? "native-image",
    maxReferenceImages: String(model.maxReferenceImages ?? 1),
    group: model.group,
    tagsText: Array.isArray(model.tags) ? model.tags.join(", ") : "",
    shortDescription: model.shortDescription ?? "",
    isRecommended: model.isRecommended,
    enabled: model.enabled,
    allowGuest: model.allowGuest,
    creditCost: String(model.creditCost),
    sortOrder: String(model.sortOrder),
    iconUrl: model.iconUrl ?? "",
    iconText: model.iconText ?? "",
    iconColor: model.iconColor ?? ""
  };
}

function formatDisplaySurfaces(
  surfaces: ModelDisplaySurface[],
  t: (key: string) => string
): string {
  const hasChat = surfaces.includes("chat");
  const hasImage = surfaces.includes("image");
  const hasVideo = surfaces.includes("video");

  if (hasChat && hasImage && !hasVideo) {
    return t("admin.modelDisplaySurfaces.both");
  }

  if (hasChat && hasImage && hasVideo) {
    return [
      t("admin.modelDisplaySurfaces.chat"),
      t("admin.modelDisplaySurfaces.image"),
      t("admin.modelDisplaySurfaces.video")
    ].join(", ");
  }

  if (hasChat && hasVideo) {
    return [
      t("admin.modelDisplaySurfaces.chat"),
      t("admin.modelDisplaySurfaces.video")
    ].join(", ");
  }

  if (hasImage && hasVideo) {
    return [
      t("admin.modelDisplaySurfaces.image"),
      t("admin.modelDisplaySurfaces.video")
    ].join(", ");
  }

  if (hasImage) {
    return t("admin.modelDisplaySurfaces.image");
  }

  if (hasVideo) {
    return t("admin.modelDisplaySurfaces.video");
  }

  return t("admin.modelDisplaySurfaces.chat");
}

function FieldHelp({ label, help }: { label: string; help: string }) {
  return (
    <div className="min-w-0">
      <div className="font-semibold text-slate-700">{label}</div>
      <div>{help}</div>
    </div>
  );
}

function ModelIcon({
  color,
  fallback,
  text
}: {
  color: string;
  fallback: string;
  text: string;
}) {
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold text-white"
      style={{ backgroundColor: color.trim() || "#64748b" }}
    >
      {(text.trim() || initialsFrom(fallback)).slice(0, 2)}
    </span>
  );
}

function initialsFrom(value: string): string {
  const compact = value.trim();

  if (!compact) {
    return "AI";
  }

  const words = compact.split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");

  return initials || compact.slice(0, 2).toUpperCase();
}
