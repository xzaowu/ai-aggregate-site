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
import { Copy, Save, Trash2 } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import {
  AdminDrawer,
  AdminDrawerBody,
  AdminDrawerFooter,
  AdminDrawerHeader,
  AdminFormActions,
  AdminFormField,
  AdminFormSection
} from "./admin-layout";
import { AdminModelProviderAccountSelect } from "./admin-model-provider-account-select";
import {
  AdminModelRoutesEditor,
  type ModelRouteFormState
} from "./admin-model-routes-editor";
import { getModelTestModelMismatchWarning } from "./admin-provider-accounts-section";
import type { ModelFormState } from "./admin-models-section";

export type { ModelRouteFormState };

type DrawerMode = "create" | "edit" | null;

interface AdminModelDetailDrawerProps {
  drawerMode: DrawerMode;
  model: AdminAiModelSummary | null;
  form: ModelFormState | null;
  newModel: ModelFormState;
  routes: AiModelRouteSummary[];
  routeForm: ModelRouteFormState;
  providerAccounts: AiProviderAccountSummary[];
  modelProviders: ModelProvider[];
  modelCapabilityOptions: ModelCapability[];
  savingModelId: string | null;
  savingModelRouteId: string | null;
  creatingModel: boolean;
  inputClass: string;
  checkboxClass: string;
  primaryButtonClass: string;
  iconButtonClass: string;
  toggleInlineClass: string;
  onClose: () => void;
  onNewModelChange: React.Dispatch<React.SetStateAction<ModelFormState>>;
  onModelInputsChange: React.Dispatch<
    React.SetStateAction<Record<string, ModelFormState>>
  >;
  onCreateModel: () => void;
  onUpdateModel: (model: AdminAiModelSummary) => void;
  onDisableModel: (model: AdminAiModelSummary) => void;
  onDeleteModel: (model: AdminAiModelSummary) => void;
  onCreateRoute: (model: AdminAiModelSummary) => void;
  onUpdateRoute: (
    model: AdminAiModelSummary,
    route: AiModelRouteSummary,
    patch: Partial<
      Pick<AiModelRouteSummary, "providerId" | "upstreamModel" | "priority" | "enabled">
    >
  ) => void;
  onDisableRoute: (model: AdminAiModelSummary, route: AiModelRouteSummary) => void;
  onRouteFormChange: (form: ModelRouteFormState) => void;
  onCopyModelId: (modelId: string) => void;
}

export function AdminModelDetailDrawer({
  drawerMode,
  model,
  form,
  newModel,
  routes,
  routeForm,
  providerAccounts,
  modelProviders,
  modelCapabilityOptions,
  savingModelId,
  savingModelRouteId,
  creatingModel,
  inputClass,
  checkboxClass,
  primaryButtonClass,
  iconButtonClass,
  toggleInlineClass,
  onClose,
  onNewModelChange,
  onModelInputsChange,
  onCreateModel,
  onUpdateModel,
  onDisableModel,
  onDeleteModel,
  onCreateRoute,
  onUpdateRoute,
  onDisableRoute,
  onRouteFormChange,
  onCopyModelId
}: AdminModelDetailDrawerProps) {
  const { t } = useI18n();

  if (!drawerMode) {
    return null;
  }

  const isCreate = drawerMode === "create";
  const title = isCreate ? t("admin.addModel") : t("admin.editModel");
  const activeForm = isCreate ? newModel : form;

  const closeLabel = t("admin.closeModelDrawer");

  return (
    <AdminDrawer open={!!drawerMode} onClose={onClose} closeLabel={closeLabel}>
      <AdminDrawerHeader
        closeLabel={closeLabel}
        description={t("admin.modelDrawerDescription")}
        iconButtonClass={iconButtonClass}
        title={title}
        onClose={onClose}
      />
      <AdminDrawerBody>
        <div className="grid gap-4">
          <DrawerSection title={t("admin.basicInfo")}>
            {isCreate ? (
              <ModelCreateForm
                checkboxClass={checkboxClass}
                form={newModel}
                inputClass={inputClass}
                modelCapabilityOptions={modelCapabilityOptions}
                modelProviders={modelProviders}
                providerAccounts={providerAccounts}
                toggleInlineClass={toggleInlineClass}
                onFormChange={onNewModelChange}
              />
            ) : model && activeForm ? (
              <ModelEditForm
                checkboxClass={checkboxClass}
                form={activeForm}
                iconButtonClass={iconButtonClass}
                inputClass={inputClass}
                model={model}
                modelCapabilityOptions={modelCapabilityOptions}
                modelProviders={modelProviders}
                providerAccounts={providerAccounts}
                toggleInlineClass={toggleInlineClass}
                onCopyModelId={onCopyModelId}
                onModelInputsChange={onModelInputsChange}
              />
            ) : null}
          </DrawerSection>

          <DrawerSection
            title={t("admin.modelRoutes")}
            description={t("admin.modelRoutesAuthorityHelp")}
          >
            {isCreate || !model ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                {t("admin.saveModelBeforeRoutes")}
              </div>
            ) : (
              <AdminModelRoutesEditor
                checkboxClass={checkboxClass}
                inputClass={inputClass}
                model={model}
                primaryButtonClass={primaryButtonClass}
                providerAccounts={providerAccounts}
                routeForm={routeForm}
                routes={routes}
                savingModelRouteId={savingModelRouteId}
                toggleInlineClass={toggleInlineClass}
                onCreateRoute={onCreateRoute}
                onDisableRoute={onDisableRoute}
                onRouteFormChange={onRouteFormChange}
                onUpdateRoute={onUpdateRoute}
              />
            )}
          </DrawerSection>

          <DrawerSection title={t("admin.dangerZone")}>
            {model && activeForm ? (
              <AdminFormActions className="justify-start">
                {activeForm.enabled ? (
                  <button
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:text-rose-300"
                    type="button"
                    disabled={savingModelId === model.id}
                    onClick={() => onDisableModel(model)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    {t("admin.disableModel")}
                  </button>
                ) : null}
                <button
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 transition hover:bg-rose-100 disabled:text-rose-300"
                  type="button"
                  disabled={savingModelId === model.id}
                  onClick={() => {
                    if (!window.confirm(t("admin.confirmDeleteModel"))) return;
                    onDeleteModel(model);
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  {t("admin.deleteModel")}
                </button>
              </AdminFormActions>
            ) : (
              <div className="text-sm text-slate-500">
                {t("admin.createModelHasNoDangerActions")}
              </div>
            )}
          </DrawerSection>
        </div>
      </AdminDrawerBody>
      <AdminDrawerFooter>
        <AdminFormActions>
          <button
            className={iconButtonClass}
            type="button"
            onClick={onClose}
          >
            {t("admin.cancel")}
          </button>
          {isCreate ? (
            <button
              className={primaryButtonClass}
              type="button"
              disabled={creatingModel}
              onClick={onCreateModel}
            >
              <Save className="size-3.5" aria-hidden="true" />
              {creatingModel ? t("admin.creating") : t("admin.addModel")}
            </button>
          ) : model ? (
            <button
              className={primaryButtonClass}
              type="button"
              disabled={savingModelId === model.id}
              onClick={() => onUpdateModel(model)}
            >
              <Save className="size-3.5" aria-hidden="true" />
              {savingModelId === model.id ? t("admin.saving") : t("admin.save")}
            </button>
          ) : null}
        </AdminFormActions>
      </AdminDrawerFooter>
    </AdminDrawer>
  );
}

function ModelCreateForm({
  form,
  providerAccounts,
  modelProviders,
  modelCapabilityOptions,
  inputClass,
  checkboxClass,
  toggleInlineClass,
  onFormChange
}: {
  form: ModelFormState;
  providerAccounts: AiProviderAccountSummary[];
  modelProviders: ModelProvider[];
  modelCapabilityOptions: ModelCapability[];
  inputClass: string;
  checkboxClass: string;
  toggleInlineClass: string;
  onFormChange: React.Dispatch<React.SetStateAction<ModelFormState>>;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <BaseModelFields
        checkboxClass={checkboxClass}
        form={form}
        inputClass={inputClass}
        modelCapabilityOptions={modelCapabilityOptions}
        modelProviders={modelProviders}
        providerAccounts={providerAccounts}
        toggleInlineClass={toggleInlineClass}
        updateForm={(patch) => onFormChange((current) => ({ ...current, ...patch }))}
      />
    </div>
  );
}

function ModelEditForm({
  model,
  form,
  providerAccounts,
  modelProviders,
  modelCapabilityOptions,
  inputClass,
  checkboxClass,
  iconButtonClass,
  toggleInlineClass,
  onModelInputsChange,
  onCopyModelId
}: {
  model: AdminAiModelSummary;
  form: ModelFormState;
  providerAccounts: AiProviderAccountSummary[];
  modelProviders: ModelProvider[];
  modelCapabilityOptions: ModelCapability[];
  inputClass: string;
  checkboxClass: string;
  iconButtonClass: string;
  toggleInlineClass: string;
  onModelInputsChange: React.Dispatch<
    React.SetStateAction<Record<string, ModelFormState>>
  >;
  onCopyModelId: (modelId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="flex min-w-0 items-center gap-2 md:col-span-2">
        <code className="min-w-0 flex-1 truncate rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
          {form.modelId}
        </code>
        <button
          className={iconButtonClass}
          type="button"
          title={t("admin.copyModelId")}
          onClick={() => onCopyModelId(form.modelId)}
        >
          <Copy className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <BaseModelFields
        checkboxClass={checkboxClass}
        form={form}
        inputClass={inputClass}
        model={model}
        modelCapabilityOptions={modelCapabilityOptions}
        modelProviders={modelProviders}
        providerAccounts={providerAccounts}
        toggleInlineClass={toggleInlineClass}
        updateForm={(patch) =>
          onModelInputsChange((current) => ({
            ...current,
            [model.id]: { ...form, ...patch }
          }))
        }
      />
    </div>
  );
}

function BaseModelFields({
  model,
  form,
  providerAccounts,
  modelProviders,
  modelCapabilityOptions,
  inputClass,
  checkboxClass,
  toggleInlineClass,
  updateForm
}: {
  model?: AdminAiModelSummary;
  form: ModelFormState;
  providerAccounts: AiProviderAccountSummary[];
  modelProviders: ModelProvider[];
  modelCapabilityOptions: ModelCapability[];
  inputClass: string;
  checkboxClass: string;
  toggleInlineClass: string;
  updateForm: (patch: Partial<ModelFormState>) => void;
}) {
  const { t } = useI18n();
  const testModelMismatch = getModelTestModelMismatchWarning(form, providerAccounts);
  const nameSuffix = model?.name ? ` ${model.name}` : "";
  const hasImageDisplaySurface = form.displaySurfaces.includes("image");
  const shouldShowChatFormatImageWarning =
    hasImageDisplaySurface && form.capability !== "image";
  const imageInvokeParserMismatch =
    form.imageInvokeMode === "anthropic-messages" &&
    form.imageOutputParser !== "markdown-data-url";
  const imageParserInvokeMismatch =
    form.imageOutputParser === "markdown-data-url" &&
    form.imageInvokeMode !== "anthropic-messages";
  const toggleDisplaySurface = (surface: ModelDisplaySurface, checked: boolean) => {
    const nextSurfaces = checked
      ? [...new Set([...form.displaySurfaces, surface])]
      : form.displaySurfaces.filter((current) => current !== surface);

    updateForm({
      displaySurfaces: nextSurfaces.length > 0 ? nextSurfaces : ["chat"]
    });
  };

  return (
    <>
      <AdminFormField label={t("admin.modelName")}>
        <input
          className={inputClass}
          aria-label={`${t("admin.modelName")}${nameSuffix}`}
          placeholder={t("admin.modelName")}
          value={form.name}
          onChange={(event) => updateForm({ name: event.target.value })}
        />
      </AdminFormField>
      <AdminFormField label={t("admin.displayName")}>
        <input
          className={inputClass}
          aria-label={`${t("admin.displayName")}${nameSuffix}`}
          placeholder={t("admin.customDisplayName")}
          value={form.displayName}
          onChange={(event) => updateForm({ displayName: event.target.value })}
        />
      </AdminFormField>
      <AdminFormField label={t("admin.realModelId")}>
        <input
          className={`${inputClass} font-mono`}
          aria-label={`${t("admin.realModelId")}${nameSuffix}`}
          placeholder={t("admin.realModelId")}
          value={form.modelId}
          onChange={(event) => updateForm({ modelId: event.target.value })}
        />
      </AdminFormField>
      <AdminFormField label={t("admin.modelCapability")}>
        <select
          className={inputClass}
          aria-label={`${t("admin.modelCapability")}${nameSuffix}`}
          value={form.capability}
          onChange={(event) =>
            updateForm({ capability: event.target.value as ModelCapability })
          }
        >
          {modelCapabilityOptions.map((capability) => (
            <option key={capability} value={capability}>
              {t(`admin.modelCapability.${capability}`)}
            </option>
          ))}
        </select>
      </AdminFormField>
      <div className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-3 text-sm md:col-span-2">
        <div>
          <div className="font-semibold text-amber-950">
            {t("admin.modelLegacyBinding")}
          </div>
          <div className="mt-1 text-xs leading-5 text-amber-800">
            {t("admin.modelLegacyBindingHelp")}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <AdminFormField label={t("admin.provider")}>
            <select
              className={inputClass}
              aria-label={`${t("admin.provider")}${nameSuffix}`}
              value={form.provider}
              onChange={(event) =>
                updateForm({ provider: event.target.value as ModelProvider })
              }
            >
              {modelProviders.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </AdminFormField>
          <AdminFormField label={t("admin.providerAccount")}>
            <AdminModelProviderAccountSelect
              accounts={providerAccounts}
              ariaLabel={`${t("admin.providerAccount")}${nameSuffix}`}
              className={inputClass}
              value={form.providerAccountId}
              onChange={(providerAccountId) => updateForm({ providerAccountId })}
            />
          </AdminFormField>
        </div>
      </div>
      <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm md:col-span-2">
        <div>
          <div className="font-semibold text-slate-800">
            {t("admin.modelDisplaySurfaces")}
          </div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            {t("admin.modelDisplaySurfacesHelp")}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={toggleInlineClass}>
            <input
              checked={form.displaySurfaces.includes("chat")}
              className={checkboxClass}
              type="checkbox"
              onChange={(event) =>
                toggleDisplaySurface("chat", event.target.checked)
              }
            />
            {t("admin.modelDisplaySurfaces.chat")}
          </label>
          <label className={toggleInlineClass}>
            <input
              checked={form.displaySurfaces.includes("image")}
              className={checkboxClass}
              type="checkbox"
              onChange={(event) =>
                toggleDisplaySurface("image", event.target.checked)
              }
            />
            {t("admin.modelDisplaySurfaces.image")}
          </label>
          <label className={toggleInlineClass}>
            <input
              checked={form.displaySurfaces.includes("video")}
              className={checkboxClass}
              type="checkbox"
              onChange={(event) =>
                toggleDisplaySurface("video", event.target.checked)
              }
            />
            {t("admin.modelDisplaySurfaces.video")}
          </label>
        </div>
      </div>
      {shouldShowChatFormatImageWarning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 md:col-span-2">
          {t("admin.chatFormatImageUnsupportedWarning")}
        </div>
      ) : null}
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm md:col-span-2">
        <div>
          <div className="font-semibold text-slate-800">
            {t("admin.modelImageRuntimeConfig")}
          </div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            {t("admin.modelImageRuntimeConfigHelp")}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <AdminFormField label={t("admin.modelImageInvokeMode")}>
            <select
              className={inputClass}
              aria-label={`${t("admin.modelImageInvokeMode")}${nameSuffix}`}
              value={form.imageInvokeMode}
              onChange={(event) =>
                updateForm({
                  imageInvokeMode: event.target.value as ModelImageInvokeMode
                })
              }
            >
              <option value="native-image">
                {t("admin.modelImageInvokeMode.native-image")}
              </option>
              <option value="anthropic-messages">
                {t("admin.modelImageInvokeMode.anthropic-messages")}
              </option>
            </select>
          </AdminFormField>
          <AdminFormField label={t("admin.modelImageOutputParser")}>
            <select
              className={inputClass}
              aria-label={`${t("admin.modelImageOutputParser")}${nameSuffix}`}
              value={form.imageOutputParser}
              onChange={(event) =>
                updateForm({
                  imageOutputParser: event.target.value as ModelImageOutputParser
                })
              }
            >
              <option value="native-image">
                {t("admin.modelImageOutputParser.native-image")}
              </option>
              <option value="markdown-data-url">
                {t("admin.modelImageOutputParser.markdown-data-url")}
              </option>
            </select>
          </AdminFormField>
          {form.capability === "image" ? (
            <AdminFormField
              help={t("admin.maxReferenceImagesHelp")}
              label={t("admin.maxReferenceImages")}
            >
              <input
                className={inputClass}
                aria-label={`${t("admin.maxReferenceImages")}${nameSuffix}`}
                max={4}
                min={0}
                step={1}
                type="number"
                value={form.maxReferenceImages}
                onChange={(event) =>
                  updateForm({ maxReferenceImages: event.target.value })
                }
              />
            </AdminFormField>
          ) : null}
        </div>
        <div className="text-xs leading-5 text-slate-500">
          {t("admin.modelImageRuntimeConfigNote")}
        </div>
      </div>
      {imageInvokeParserMismatch ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 md:col-span-2">
          {t("admin.modelImageInvokeParserMismatch")}
        </div>
      ) : null}
      {imageParserInvokeMismatch ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 md:col-span-2">
          {t("admin.modelImageParserInvokeMismatch")}
        </div>
      ) : null}
      {testModelMismatch ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 md:col-span-2">
          {t("admin.modelTestModelMismatchWarning")}
        </div>
      ) : null}
      <AdminFormField label={t("admin.modelGroup")}>
        <input
          className={inputClass}
          aria-label={`${t("admin.modelGroup")}${nameSuffix}`}
          placeholder={t("admin.modelGroup")}
          value={form.group}
          onChange={(event) => updateForm({ group: event.target.value })}
        />
      </AdminFormField>
      <AdminFormField label={t("admin.modelTags")}>
        <input
          className={inputClass}
          aria-label={`${t("admin.modelTags")}${nameSuffix}`}
          placeholder={t("admin.modelTags")}
          value={form.tagsText}
          onChange={(event) => updateForm({ tagsText: event.target.value })}
        />
      </AdminFormField>
      <AdminFormField label={t("admin.creditCost")}>
        <input
          className={inputClass}
          min={0}
          type="number"
          aria-label={`${t("admin.creditCost")}${nameSuffix}`}
          placeholder={t("admin.creditCost")}
          value={form.creditCost}
          onChange={(event) => updateForm({ creditCost: event.target.value })}
        />
      </AdminFormField>
      <AdminFormField label={t("admin.sort")}>
        <input
          className={inputClass}
          type="number"
          aria-label={`${t("admin.sort")}${nameSuffix}`}
          placeholder={t("admin.sort")}
          value={form.sortOrder}
          onChange={(event) => updateForm({ sortOrder: event.target.value })}
        />
      </AdminFormField>
      <AdminFormField label={t("admin.iconUrl")}>
        <input
          className={inputClass}
          aria-label={`${t("admin.iconUrl")}${nameSuffix}`}
          placeholder={t("admin.iconUrl")}
          value={form.iconUrl}
          onChange={(event) => updateForm({ iconUrl: event.target.value })}
        />
      </AdminFormField>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <AdminFormField label={t("admin.iconText")}>
          <input
            className={inputClass}
            aria-label={`${t("admin.iconText")}${nameSuffix}`}
            placeholder={t("admin.iconText")}
            value={form.iconText}
            onChange={(event) => updateForm({ iconText: event.target.value })}
          />
        </AdminFormField>
        <AdminFormField label={t("admin.iconColor")}>
          <input
            className={inputClass}
            aria-label={`${t("admin.iconColor")}${nameSuffix}`}
            placeholder={t("admin.iconColor")}
            value={form.iconColor}
            onChange={(event) => updateForm({ iconColor: event.target.value })}
          />
        </AdminFormField>
        <ModelIconPreview
          iconUrl={form.iconUrl}
          iconText={form.iconText}
          iconColor={form.iconColor}
          fallback={form.displayName || form.name || "AI"}
          label={t("admin.iconPreview")}
        />
      </div>
      <AdminFormField className="md:col-span-2" label={t("admin.modelDescription")}>
        <textarea
          className={`${inputClass} min-h-28 resize-y leading-6`}
          aria-label={`${t("admin.modelDescription")}${nameSuffix}`}
          placeholder={t("admin.modelDescription")}
          rows={3}
          value={form.shortDescription}
          onChange={(event) => updateForm({ shortDescription: event.target.value })}
        />
      </AdminFormField>
      <div className="grid gap-2 sm:grid-cols-3 md:col-span-2">
        <label className={toggleInlineClass}>
          <input
            checked={form.enabled}
            className={checkboxClass}
            type="checkbox"
            onChange={(event) => updateForm({ enabled: event.target.checked })}
          />
          {form.enabled ? t("admin.enabled") : t("admin.disabled")}
        </label>
        <label className={toggleInlineClass}>
          <input
            checked={form.allowGuest}
            className={checkboxClass}
            type="checkbox"
            onChange={(event) => updateForm({ allowGuest: event.target.checked })}
          />
          {t("admin.allowGuestUsage")}
        </label>
        <label className={toggleInlineClass}>
          <input
            checked={form.isRecommended}
            className={checkboxClass}
            type="checkbox"
            onChange={(event) =>
              updateForm({ isRecommended: event.target.checked })
            }
          />
          {t("admin.recommendedModel")}
        </label>
      </div>
    </>
  );
}

function DrawerSection({
  children,
  description,
  title
}: {
  children: React.ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <AdminFormSection description={description} title={title}>
      {children}
    </AdminFormSection>
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

function ModelIconPreview({
  iconUrl,
  iconText,
  iconColor,
  fallback,
  label
}: {
  iconUrl: string;
  iconText: string;
  iconColor: string;
  fallback: string;
  label: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const trimmedUrl = iconUrl.trim();
  const text = iconText.trim() || initialsFrom(fallback);

  useEffect(() => {
    setImageFailed(false);
  }, [trimmedUrl]);

  return (
    <span
      className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-xs font-bold text-white"
      aria-label={label}
      title={label}
      style={{ backgroundColor: iconColor.trim() || "#64748b" }}
    >
      {trimmedUrl && !imageFailed ? (
        <img
          alt={label}
          className="size-7 object-contain"
          src={trimmedUrl}
          onError={() => setImageFailed(true)}
        />
      ) : (
        text
      )}
    </span>
  );
}
