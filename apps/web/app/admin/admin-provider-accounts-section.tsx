"use client";

import type {
  AdminModerationRouteSummary,
  AiProviderAccountSummary,
  ProviderAccountCapability,
  ProviderAccountType
} from "@ai-aggregate/shared";
import { Pencil, PlugZap, Plus, Save, Trash2 } from "lucide-react";
import React from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import {
  MODERATION_REQUEST_FORMAT,
  canChangeProviderModerationEnabled,
  getModerationReferenceInfoFromRoutes,
  isProviderModerationToggleDisabled,
  mergeProviderModerationConfig,
  readProviderModerationForm,
  type ModerationReferenceInfo,
  type ProviderModerationFormState
} from "./admin-moderation";
import { AdminAdvancedJsonEditor } from "./admin-advanced-json-editor";
import { AdminProviderAccountDrawer } from "./admin-provider-account-drawer";
import {
  AdminDataTable,
  AdminFormActions,
  AdminFormField as FieldShell,
  AdminFormSection as FormGroup,
  AdminSection,
  AdminSectionHeader,
  AdminStatusBadge,
  AdminTableCell,
  AdminTableEmptyRow,
  AdminTableHeadCell
} from "./admin-layout";

export type ProviderAccountRequestFormat = "openai-compatible" | "anthropic";
export type ProviderAccountAnthropicAuthMode = "x-api-key" | "bearer" | "both";
export type ProviderAccountTestCapability = "chat" | "image";

export interface ProviderAccountFormState {
  name: string;
  providerType: ProviderAccountType;
  requestFormat: ProviderAccountRequestFormat;
  anthropicAuthMode: ProviderAccountAnthropicAuthMode;
  messagesPath: string;
  testModel: string;
  testCapability: ProviderAccountTestCapability | "";
  baseUrl: string;
  apiKey: string;
  capabilitiesText: string;
  enabled: boolean;
  priority: string;
  timeoutMs: string;
  headersJson: string;
  configJson: string;
  notes: string;
  moderationEnabled?: boolean;
  moderationRequestFormat?: typeof MODERATION_REQUEST_FORMAT;
  moderationUpstreamModel?: string;
  moderationEndpointPath?: string;
  moderationSupportsText?: boolean;
  moderationSupportsImage?: boolean;
}

export interface ProviderAccountTestResult {
  status: "success" | "error";
  message: string;
  capability?: ProviderAccountTestCapability;
  imageTransport?: "openai-images" | "legacy-extra-body-v1";
  errorCode?: string;
  model?: string;
  latencyMs?: number;
  requestFormat?: ProviderAccountRequestFormat;
  authMode?: ProviderAccountAnthropicAuthMode;
  endpointPath?: string;
  statusCode?: number;
  routeEnabled?: boolean;
  providerEnabled?: boolean;
}

export function clearProviderAccountTestResult(
  current: Record<string, ProviderAccountTestResult | undefined>,
  accountId: string
): Record<string, ProviderAccountTestResult | undefined> {
  const next = { ...current };
  delete next[accountId];
  return next;
}

export interface AdminProviderAccountsSectionProps {
  accounts: AiProviderAccountSummary[];
  newAccount: ProviderAccountFormState;
  accountInputs: Record<string, ProviderAccountFormState>;
  creatingAccount: boolean;
  savingAccountId: string | null;
  testingNewAccount: boolean;
  testingAccountId: string | null;
  testResults: Record<string, ProviderAccountTestResult | undefined>;
  inputClass: string;
  checkboxClass: string;
  primaryButtonClass: string;
  iconButtonClass: string;
  toggleInlineClass: string;
  moderationRoutes?: AdminModerationRouteSummary[];
  moderationReferenceDataAvailable?: boolean;
  onNewAccountChange: (form: ProviderAccountFormState) => void;
  onAccountInputChange: (id: string, form: ProviderAccountFormState) => void;
  onCreateAccount: () => void | Promise<boolean>;
  onUpdateAccount: (account: AiProviderAccountSummary) => void | Promise<boolean>;
  onDisableAccount: (account: AiProviderAccountSummary) => void;
  onTestNewAccount: () => void;
  onTestAccount: (account: AiProviderAccountSummary) => void;
}

export const providerAccountTypes: ProviderAccountType[] = [
  "SUB2API",
  "OPENAI_COMPATIBLE",
  "NEW_API",
  "ANTHROPIC",
  "AGNES_IMAGE"
];

export const providerAccountCapabilities: ProviderAccountCapability[] = [
  "chat",
  "image",
  "video",
  "ppt"
];

export interface ProviderAccountCapabilitiesInput {
  capabilities: ProviderAccountCapability[];
  invalidCapabilities: string[];
}

export const providerAccountRequestFormats: ProviderAccountRequestFormat[] = [
  "openai-compatible",
  "anthropic"
];

export const providerAccountAnthropicAuthModes: ProviderAccountAnthropicAuthMode[] = [
  "x-api-key",
  "bearer",
  "both"
];

export function parseProviderAccountCapabilitiesInput(
  value: string
): ProviderAccountCapabilitiesInput {
  const capabilities: ProviderAccountCapability[] = [];
  const invalidCapabilities: string[] = [];
  const seenCapabilities = new Set<string>();
  const seenInvalidCapabilities = new Set<string>();

  for (const rawToken of value.split(/\r?\n|,/)) {
    const token = rawToken.trim();

    if (!token) {
      continue;
    }

    if (providerAccountCapabilities.includes(token as ProviderAccountCapability)) {
      if (!seenCapabilities.has(token)) {
        seenCapabilities.add(token);
        capabilities.push(token as ProviderAccountCapability);
      }
      continue;
    }

    if (!seenInvalidCapabilities.has(token)) {
      seenInvalidCapabilities.add(token);
      invalidCapabilities.push(token);
    }
  }

  return { capabilities, invalidCapabilities };
}

export function getProviderTestableCapabilities(
  capabilities: ProviderAccountCapability[] | string
): ProviderAccountTestCapability[] {
  const values =
    typeof capabilities === "string"
      ? parseProviderAccountCapabilitiesInput(capabilities).capabilities
      : capabilities;

  return Array.from(
    new Set(
      values.filter(
        (capability): capability is ProviderAccountTestCapability =>
          capability === "chat" || capability === "image"
      )
    )
  );
}

export function getDefaultProviderAccountRequestFormat(
  providerType: ProviderAccountType
): ProviderAccountRequestFormat {
  return providerType === "ANTHROPIC" ? "anthropic" : "openai-compatible";
}

export function getDefaultProviderAccountAnthropicAuthMode(
  providerType: ProviderAccountType,
  requestFormat: ProviderAccountRequestFormat
): ProviderAccountAnthropicAuthMode {
  if (
    requestFormat === "anthropic" &&
    (providerType === "SUB2API" ||
      providerType === "NEW_API" ||
      providerType === "OPENAI_COMPATIBLE")
  ) {
    return "both";
  }

  return "x-api-key";
}

export function readProviderAccountTestModel(
  account: AiProviderAccountSummary | null | undefined
): string | null {
  const value = account?.configJson?.testModel;

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getModelTestModelMismatchWarning(
  form: { modelId: string; providerAccountId: string },
  accounts: AiProviderAccountSummary[]
): string | null {
  const account = accounts.find((item) => item.id === form.providerAccountId);
  const testModel = readProviderAccountTestModel(account);
  const modelId = form.modelId.trim();

  if (!account || !testModel || !modelId || testModel === modelId) {
    return null;
  }

  return testModel;
}

function isProviderAccountRequestFormat(
  value: unknown
): value is ProviderAccountRequestFormat {
  return value === "openai-compatible" || value === "anthropic";
}

function isProviderAccountAnthropicAuthMode(
  value: unknown
): value is ProviderAccountAnthropicAuthMode {
  return value === "x-api-key" || value === "bearer" || value === "both";
}

function readStringConfigValue(
  configJson: Record<string, unknown> | null,
  key: string
): string {
  const value = configJson?.[key];

  return typeof value === "string" ? value : "";
}

function readRequestFormatFromConfig(
  configJson: Record<string, unknown> | null,
  providerType: ProviderAccountType
): ProviderAccountRequestFormat {
  const value =
    configJson?.requestFormat ?? configJson?.adapterFormat ?? configJson?.chatFormat;

  return isProviderAccountRequestFormat(value)
    ? value
    : getDefaultProviderAccountRequestFormat(providerType);
}

function readAnthropicAuthModeFromConfig(
  configJson: Record<string, unknown> | null,
  providerType: ProviderAccountType,
  requestFormat: ProviderAccountRequestFormat
): ProviderAccountAnthropicAuthMode {
  const value =
    configJson?.anthropicAuthMode ??
    configJson?.authHeaderMode ??
    configJson?.authMode;

  return isProviderAccountAnthropicAuthMode(value)
    ? value
    : getDefaultProviderAccountAnthropicAuthMode(providerType, requestFormat);
}

function parseJsonObjectField(value: string): Record<string, unknown> | null | false {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : false;
  } catch {
    return false;
  }
}

export function mergeProviderAccountConfigJson(
  form: ProviderAccountFormState,
  configJson: Record<string, unknown> | null
): Record<string, unknown> | null {
  const nextConfig = { ...(configJson ?? {}) };
  nextConfig.requestFormat = form.requestFormat;

  if (form.requestFormat === "anthropic") {
    nextConfig.anthropicAuthMode = form.anthropicAuthMode;
  } else {
    delete nextConfig.anthropicAuthMode;
  }

  if (form.messagesPath.trim()) {
    nextConfig.messagesPath = form.messagesPath.trim();
  } else {
    delete nextConfig.messagesPath;
  }

  if (form.testModel.trim()) {
    nextConfig.testModel = form.testModel.trim();
  } else {
    delete nextConfig.testModel;
  }

  const moderation: ProviderModerationFormState = {
    enabled: form.moderationEnabled === true,
    requestFormat: MODERATION_REQUEST_FORMAT,
    upstreamModel: form.moderationUpstreamModel ?? "",
    endpointPath: form.moderationEndpointPath ?? "",
    supportsText: form.moderationSupportsText !== false,
    supportsImage: form.moderationSupportsImage !== false
  };

  return mergeProviderModerationConfig(nextConfig, moderation);
}

export function parseProviderAccountTestPayload(
  form: ProviderAccountFormState,
  providerAccountId?: string
): Record<string, unknown> | null {
  const headersJson = parseJsonObjectField(form.headersJson);
  const rawConfigJson = parseJsonObjectField(form.configJson);
  const { capabilities, invalidCapabilities } =
    parseProviderAccountCapabilitiesInput(form.capabilitiesText);

  if (
    headersJson === false ||
    rawConfigJson === false ||
    invalidCapabilities.length > 0 ||
    (!providerAccountId && form.baseUrl.trim().length === 0)
  ) {
    return null;
  }

  const configJson = mergeProviderAccountConfigJson(form, rawConfigJson);
  const testableCapabilities = getProviderTestableCapabilities(capabilities);
  const testCapability =
    testableCapabilities.length === 1
      ? testableCapabilities[0]
      : getProviderTestableCapabilities([form.testCapability as ProviderAccountCapability])[0];

  return {
    ...(providerAccountId
      ? { providerAccountId }
      : { providerType: form.providerType }),
    ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
    apiKey: form.apiKey,
    requestFormat: form.requestFormat,
    ...(form.requestFormat === "anthropic"
      ? { anthropicAuthMode: form.anthropicAuthMode }
      : {}),
    ...(testCapability ? { testCapability } : {}),
    testModel: form.testModel.trim(),
    timeoutMs: Number(form.timeoutMs),
    ...(form.headersJson.trim() ? { headersJson } : {}),
    configJson,
    capabilities
  };
}

export function AdminProviderAccountsSection({
  accounts,
  newAccount,
  accountInputs,
  creatingAccount,
  savingAccountId,
  testingNewAccount,
  testingAccountId,
  testResults,
  inputClass,
  checkboxClass,
  primaryButtonClass,
  iconButtonClass,
  toggleInlineClass,
  moderationRoutes = [],
  moderationReferenceDataAvailable = false,
  onNewAccountChange,
  onAccountInputChange,
  onCreateAccount,
  onUpdateAccount,
  onDisableAccount,
  onTestNewAccount,
  onTestAccount
}: AdminProviderAccountsSectionProps) {
  const { t } = useI18n();
  const [drawerTarget, setDrawerTarget] = React.useState<"new" | string | null>(
    accounts.length === 0 ? "new" : null
  );
  const selectedAccount =
    drawerTarget && drawerTarget !== "new"
      ? accounts.find((account) => account.id === drawerTarget) ?? null
      : null;
  const selectedForm = selectedAccount
    ? accountInputs[selectedAccount.id] ?? providerAccountToForm(selectedAccount)
    : null;

  const getModerationReferenceInfo = (accountId: string): ModerationReferenceInfo =>
    moderationReferenceDataAvailable
      ? getModerationReferenceInfoFromRoutes(moderationRoutes, accountId)
      : { known: false, count: null };

  async function createAccountAndClose() {
    if (await onCreateAccount()) {
      setDrawerTarget(null);
    }
  }

  async function updateAccountAndClose(account: AiProviderAccountSummary) {
    if (await onUpdateAccount(account)) {
      setDrawerTarget(null);
    }
  }

  return (
    <AdminSection>
      <AdminSectionHeader
        description={t("admin.providerAccountsListHelp")}
        title={t("admin.providerAccounts")}
      >
        <button
          className={primaryButtonClass}
          type="button"
          onClick={() => setDrawerTarget("new")}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          {t("admin.createProviderAccount")}
        </button>
      </AdminSectionHeader>

      <AdminDataTable className="bg-slate-50/40">
        <table
          className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm lg:min-w-[1180px]"
          data-admin-data-surface="provider-accounts"
        >
          <thead className="bg-slate-50">
            <tr>
              <AdminTableHeadCell>{t("admin.providerAccountName")}</AdminTableHeadCell>
              <AdminTableHeadCell>{t("admin.providerType")}</AdminTableHeadCell>
              <AdminTableHeadCell priority="secondary">
                {t("admin.requestFormat")}
              </AdminTableHeadCell>
              <AdminTableHeadCell priority="tertiary">
                {t("admin.baseUrl")}
              </AdminTableHeadCell>
              <AdminTableHeadCell priority="secondary">
                {t("admin.capabilities")}
              </AdminTableHeadCell>
              <AdminTableHeadCell priority="tertiary">{t("admin.priority")}</AdminTableHeadCell>
              <AdminTableHeadCell priority="tertiary">{t("admin.timeoutMs")}</AdminTableHeadCell>
              <AdminTableHeadCell>{t("admin.providerAccountTestStatus")}</AdminTableHeadCell>
              <AdminTableHeadCell>{t("admin.enabled")}</AdminTableHeadCell>
              <AdminTableHeadCell>{t("admin.providerAccountActions")}</AdminTableHeadCell>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {accounts.length === 0 ? (
              <AdminTableEmptyRow colSpan={10}>
                <span>{t("admin.noProviderAccounts")}</span>
                <button
                  className={`${primaryButtonClass} ml-3 min-h-9`}
                  type="button"
                  onClick={() => setDrawerTarget("new")}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  {t("admin.createProviderAccount")}
                </button>
              </AdminTableEmptyRow>
            ) : (
              accounts.map((account) => {
                const form = accountInputs[account.id] ?? providerAccountToForm(account);
                const testResult = testResults[account.id];

                return (
                  <tr
                    key={account.id}
                    className="bg-white transition-colors hover:bg-slate-50/80"
                    data-admin-table-row="true"
                  >
                    <AdminTableCell className="font-semibold text-slate-950">
                      <span data-admin-provider-account-card>{account.name}</span>
                    </AdminTableCell>
                    <AdminTableCell className="text-slate-700">
                      <AdminStatusBadge tone="indigo">
                        {account.providerType}
                      </AdminStatusBadge>
                    </AdminTableCell>
                    <AdminTableCell priority="secondary" className="text-slate-700">
                      <AdminStatusBadge tone="slate">
                        {t(`admin.requestFormat.${form.requestFormat}`)}
                      </AdminStatusBadge>
                    </AdminTableCell>
                    <AdminTableCell
                      priority="tertiary"
                      className="max-w-[200px] truncate font-mono text-xs text-slate-600"
                      title={formatBaseUrlSummary(account.baseUrl) || undefined}
                    >
                      {formatBaseUrlSummary(account.baseUrl) || "-"}
                    </AdminTableCell>
                    <AdminTableCell priority="secondary" className="max-w-[140px]">
                      <div className="flex flex-wrap gap-1">
                        {account.capabilities.map((capability) => (
                          <AdminStatusBadge
                            key={capability}
                            tone="slate"
                          >
                            {t(`admin.modelCapability.${capability}`)}
                          </AdminStatusBadge>
                        ))}
                      </div>
                    </AdminTableCell>
                    <AdminTableCell priority="tertiary" className="whitespace-nowrap text-slate-700">
                      {account.priority}
                    </AdminTableCell>
                    <AdminTableCell priority="tertiary" className="whitespace-nowrap text-slate-700">
                      {account.timeoutMs}
                    </AdminTableCell>
                    <AdminTableCell className="max-w-[180px]">
                      {testResult ? (
                        <ProviderAccountTestResultInline result={testResult} />
                      ) : (
                        <span className="text-xs text-slate-400">{t("admin.providerAccountNotTested")}</span>
                      )}
                    </AdminTableCell>
                    <AdminTableCell>
                      <AdminStatusBadge tone={account.enabled ? "emerald" : "slate"}>
                        {account.enabled ? t("admin.enabled") : t("admin.disabled")}
                      </AdminStatusBadge>
                    </AdminTableCell>
                    <AdminTableCell>
                      <div className="flex min-w-max items-center justify-end gap-1.5">
                        <button
                          className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-xs font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-50 disabled:text-slate-300"
                          type="button"
                          disabled={testingAccountId === account.id}
                          onClick={() => onTestAccount(account)}
                        >
                          <PlugZap className="size-3" aria-hidden="true" />
                          {testingAccountId === account.id
                            ? t("admin.testingConnection")
                            : t("admin.testConnection")}
                        </button>
                        <button
                          className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700"
                          type="button"
                          onClick={() => setDrawerTarget(account.id)}
                        >
                          <Pencil className="size-3" aria-hidden="true" />
                          {t("admin.editProviderAccount")}
                        </button>
                        {account.enabled ? (
                          <button
                            className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1.5 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:text-rose-300"
                            type="button"
                            disabled={savingAccountId === account.id}
                            onClick={() => onDisableAccount(account)}
                          >
                            <Trash2 className="size-3" aria-hidden="true" />
                            {t("admin.disableProviderAccount")}
                          </button>
                        ) : null}
                      </div>
                    </AdminTableCell>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </AdminDataTable>

      <AdminProviderAccountDrawer
        open={drawerTarget === "new"}
        title={t("admin.createProviderAccount")}
        description={t("admin.providerAccountDrawerDescription")}
        iconButtonClass={iconButtonClass}
        onClose={() => setDrawerTarget(null)}
        footer={
          <AdminFormActions>
            <button
              className={iconButtonClass}
              type="button"
              onClick={() => setDrawerTarget(null)}
            >
              {t("admin.cancel")}
            </button>
            <button
              className={primaryButtonClass}
              type="button"
              disabled={creatingAccount}
              onClick={() => void createAccountAndClose()}
            >
              <Save className="size-3.5" aria-hidden="true" />
              {creatingAccount ? t("admin.creating") : t("admin.createProviderAccount")}
            </button>
          </AdminFormActions>
        }
      >
        <ProviderAccountForm
          form={newAccount}
          inputClass={inputClass}
          checkboxClass={checkboxClass}
          toggleInlineClass={toggleInlineClass}
          testLabel={
            testingNewAccount
              ? t("admin.testingConnection")
              : t("admin.testConnection")
          }
          testDisabled={testingNewAccount}
          testResult={testResults["new"]}
          hasSavedApiKey={false}
          moderationReferenceInfo={{ known: true, count: 0 }}
          onChange={onNewAccountChange}
          onTest={onTestNewAccount}
        />
      </AdminProviderAccountDrawer>

      {selectedAccount && selectedForm ? (
        <AdminProviderAccountDrawer
          open
          title={selectedAccount.name}
          description={t("admin.providerAccountDrawerDescription")}
          iconButtonClass={iconButtonClass}
          onClose={() => setDrawerTarget(null)}
          footer={
            <AdminFormActions>
              <button
                className={iconButtonClass}
                type="button"
                onClick={() => setDrawerTarget(null)}
              >
                {t("admin.cancel")}
              </button>
              <button
                className={primaryButtonClass}
                type="button"
                disabled={savingAccountId === selectedAccount.id}
                onClick={() => void updateAccountAndClose(selectedAccount)}
              >
                <Save className="size-3.5" aria-hidden="true" />
                {savingAccountId === selectedAccount.id ? t("admin.saving") : t("admin.save")}
              </button>
            </AdminFormActions>
          }
        >
          <ProviderAccountForm
            form={selectedForm}
            inputClass={inputClass}
            checkboxClass={checkboxClass}
            toggleInlineClass={toggleInlineClass}
            testLabel={
              testingAccountId === selectedAccount.id
                ? t("admin.testingConnection")
                : t("admin.testConnection")
            }
            testDisabled={testingAccountId === selectedAccount.id}
            testResult={testResults[selectedAccount.id]}
            hasSavedApiKey={selectedAccount.hasApiKey}
            hasSavedCustomHeaders={selectedAccount.hasCustomHeaders}
            moderationReferenceInfo={getModerationReferenceInfo(selectedAccount.id)}
            editMode
            onChange={(nextForm) =>
              onAccountInputChange(selectedAccount.id, nextForm)
            }
            onTest={() => onTestAccount(selectedAccount)}
          />
        </AdminProviderAccountDrawer>
      ) : null}
    </AdminSection>
  );
}

function ProviderAccountForm({
  form,
  inputClass,
  checkboxClass,
  toggleInlineClass,
  testLabel,
  testDisabled,
  testResult,
  hasSavedApiKey = false,
  hasSavedCustomHeaders = false,
  moderationReferenceInfo = { known: true, count: 0 },
  editMode = false,
  onChange,
  onTest
}: {
  form: ProviderAccountFormState;
  inputClass: string;
  checkboxClass: string;
  toggleInlineClass: string;
  testLabel: string;
  testDisabled: boolean;
  testResult?: ProviderAccountTestResult;
  hasSavedApiKey?: boolean;
  hasSavedCustomHeaders?: boolean;
  moderationReferenceInfo?: ModerationReferenceInfo;
  editMode?: boolean;
  onChange: (form: ProviderAccountFormState) => void;
  onTest: () => void;
}) {
  const { t } = useI18n();
  const { invalidCapabilities } = parseProviderAccountCapabilitiesInput(
    form.capabilitiesText
  );
  const testableCapabilities = getProviderTestableCapabilities(
    form.capabilitiesText
  );
  const selectedTestCapability =
    testableCapabilities.length === 1
      ? testableCapabilities[0]
      : testableCapabilities.includes(
            form.testCapability as ProviderAccountTestCapability
          )
        ? (form.testCapability as ProviderAccountTestCapability)
        : "";
  const capabilityTestDisabled =
    invalidCapabilities.length > 0 ||
    testableCapabilities.length === 0 ||
    (testableCapabilities.length > 1 && selectedTestCapability === "");
  const apiKeyInput = form.apiKey.trim();

  return (
    <div className="grid min-w-0 gap-5">
      <FormGroup title={t("admin.providerAccountGroup.basic")}>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <FieldShell
            label={t("admin.providerAccountName")}
            help={t("admin.providerAccountNameHelp")}
          >
            <input
              className={inputClass}
              placeholder={t("admin.providerAccountName")}
              value={form.name}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
            />
          </FieldShell>
          <FieldShell label={t("admin.providerType")} help={t("admin.providerTypeHelp")}>
            <select
              className={inputClass}
              aria-label={t("admin.providerType")}
              value={form.providerType}
              onChange={(event) => {
                const providerType = event.target.value as ProviderAccountType;
                const requestFormat = getDefaultProviderAccountRequestFormat(providerType);
                onChange({
                  ...form,
                  providerType,
                  requestFormat,
                  anthropicAuthMode: getDefaultProviderAccountAnthropicAuthMode(
                    providerType,
                    requestFormat
                  )
                });
              }}
            >
              {providerAccountTypes.map((providerType) => (
                <option key={providerType} value={providerType}>
                  {providerType}
                </option>
              ))}
            </select>
          </FieldShell>
          <FieldShell label={t("admin.baseUrl")} help={t("admin.baseUrlHelp")}>
            <input
              className={`${inputClass} font-mono`}
              placeholder="https://example.com/v1"
              value={form.baseUrl}
              onChange={(event) => onChange({ ...form, baseUrl: event.target.value })}
            />
          </FieldShell>
          <div className="grid gap-2">
            <FieldShell label={t("admin.apiKey")} help={t("admin.apiKeyHelp")}>
              <input
                autoComplete="new-password"
                className={inputClass}
                placeholder={editMode ? t("admin.leaveApiKeyBlank") : t("admin.apiKey")}
                type="password"
                value={form.apiKey}
                onChange={(event) => onChange({ ...form, apiKey: event.target.value })}
              />
            </FieldShell>
            <div className="grid gap-1 text-xs leading-5">
              <p className="font-semibold text-slate-700">
                {apiKeyInput
                  ? editMode && hasSavedApiKey
                    ? t("admin.apiKeyReplacementUnsaved")
                    : t("admin.apiKeyNewUnsaved")
                  : hasSavedApiKey
                    ? t("admin.apiKeyConfigured")
                    : t("admin.apiKeyNotConfigured")}
              </p>
              {!apiKeyInput ? (
                <p className="text-slate-500">
                  {hasSavedApiKey
                    ? t("admin.apiKeyConfiguredHelp")
                    : t("admin.apiKeyNotConfiguredHelp")}
                </p>
              ) : null}
            </div>
          </div>
          <div className="grid gap-1.5">
            <FieldShell label={t("admin.capabilities")} help={t("admin.capabilitiesHelp")}>
              <input
                className={inputClass}
                placeholder={t("admin.capabilities")}
                value={form.capabilitiesText}
                onChange={(event) => {
                  const capabilitiesText = event.target.value;
                  const nextTestableCapabilities = getProviderTestableCapabilities(
                    capabilitiesText
                  );
                  onChange({
                    ...form,
                    capabilitiesText,
                    ...(testableCapabilities.length <= 1 &&
                    nextTestableCapabilities.length > 1
                      ? { testCapability: "" }
                      : {})
                  });
                }}
              />
            </FieldShell>
            {invalidCapabilities.length > 0 ? (
              <p className="text-xs font-semibold text-rose-700" role="alert">
                {t(
                  invalidCapabilities.length === 1
                    ? "admin.unsupportedCapability"
                    : "admin.unsupportedCapabilities",
                  { value: invalidCapabilities.join(", ") }
                )}
              </p>
            ) : null}
          </div>
          <label className={toggleInlineClass}>
            <input
              checked={form.enabled}
              className={checkboxClass}
              type="checkbox"
              onChange={(event) => onChange({ ...form, enabled: event.target.checked })}
            />
            {form.enabled ? t("admin.enabled") : t("admin.disabled")}
          </label>
          <FieldShell label={t("admin.priority")} help={t("admin.priorityHelp")}>
            <input
              className={inputClass}
              placeholder={t("admin.priority")}
              type="number"
              value={form.priority}
              onChange={(event) => onChange({ ...form, priority: event.target.value })}
            />
          </FieldShell>
          <FieldShell label={t("admin.timeoutMs")} help={t("admin.timeoutMsHelp")}>
            <input
              className={inputClass}
              placeholder={t("admin.timeoutMs")}
              type="number"
              value={form.timeoutMs}
              onChange={(event) => onChange({ ...form, timeoutMs: event.target.value })}
            />
          </FieldShell>
        </div>
      </FormGroup>

      <FormGroup title={t("admin.providerAccountGroup.protocol")}>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <FieldShell label={t("admin.requestFormat")} help={t("admin.requestFormatHelp")}>
            <select
              className={inputClass}
              aria-label={t("admin.requestFormat")}
              value={form.requestFormat}
              onChange={(event) => {
                const requestFormat = event.target.value as ProviderAccountRequestFormat;
                onChange({
                  ...form,
                  requestFormat,
                  anthropicAuthMode: getDefaultProviderAccountAnthropicAuthMode(
                    form.providerType,
                    requestFormat
                  )
                });
              }}
            >
              {providerAccountRequestFormats.map((requestFormat) => (
                <option key={requestFormat} value={requestFormat}>
                  {t(`admin.requestFormat.${requestFormat}`)}
                </option>
              ))}
            </select>
          </FieldShell>
          {form.requestFormat === "anthropic" ? (
            <FieldShell
              label={t("admin.anthropicAuthMode")}
              help={t("admin.anthropicAuthModeHelp")}
            >
              <select
                className={inputClass}
                aria-label={t("admin.anthropicAuthMode")}
                value={form.anthropicAuthMode}
                onChange={(event) =>
                  onChange({
                    ...form,
                    anthropicAuthMode: event.target
                      .value as ProviderAccountAnthropicAuthMode
                  })
                }
              >
                {providerAccountAnthropicAuthModes.map((authMode) => (
                  <option key={authMode} value={authMode}>
                    {t(`admin.anthropicAuthMode.${authMode}`)}
                  </option>
                ))}
              </select>
            </FieldShell>
          ) : null}
          <FieldShell label={t("admin.messagesPath")} help={t("admin.messagesPathHelp")}>
            <input
              className={`${inputClass} font-mono`}
              placeholder="/v1/messages"
              value={form.messagesPath}
              onChange={(event) =>
                onChange({ ...form, messagesPath: event.target.value })
              }
            />
          </FieldShell>
        </div>
        <div className="grid gap-3 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-900">
          <p>{t("admin.openAiCompatibleBaseUrlGuide")}</p>
          <p>{t("admin.anthropicMessagesBaseUrlGuide")}</p>
          <p>{t("admin.sub2apiClaudeFormatHelp")}</p>
        </div>
      </FormGroup>

      <FormGroup title={t("admin.providerModerationGroup")}>
        <div className="grid gap-4">
          <label className={toggleInlineClass}>
            <span>
              <span className="block">{t("admin.providerModerationEnabled")}</span>
              {form.moderationEnabled && !moderationReferenceInfo.known ? (
                <span className="mt-1 block text-xs font-normal text-amber-700">
                  {t("admin.providerModerationReferencesUnknown")}
                </span>
              ) : moderationReferenceInfo.known && moderationReferenceInfo.count > 0 ? (
                <span className="mt-1 block text-xs font-normal text-amber-700">
                  {t("admin.providerModerationReferenced", {
                    count: moderationReferenceInfo.count
                  })}
                </span>
              ) : null}
            </span>
            <input
              aria-label={t("admin.providerModerationEnabled")}
              checked={form.moderationEnabled}
              className={checkboxClass}
              disabled={isProviderModerationToggleDisabled(
                form.moderationEnabled,
                moderationReferenceInfo
              )}
              type="checkbox"
              onChange={(event) => {
                if (
                  !canChangeProviderModerationEnabled(
                    form.moderationEnabled,
                    event.target.checked,
                    moderationReferenceInfo
                  )
                ) {
                  return;
                }
                onChange({ ...form, moderationEnabled: event.target.checked });
              }}
            />
          </label>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <FieldShell
              label={t("admin.providerModerationRequestFormat")}
              help={t("admin.providerModerationRequestFormatHelp")}
            >
              <input
                aria-label={t("admin.providerModerationRequestFormat")}
                className={`${inputClass} font-mono`}
                readOnly
                value={form.moderationRequestFormat}
              />
            </FieldShell>
            <FieldShell
              label={t("admin.providerModerationModel")}
              help={t("admin.providerModerationModelHelp")}
            >
              <input
                aria-label={t("admin.providerModerationModel")}
                className={`${inputClass} font-mono`}
                disabled={!form.moderationEnabled}
                value={form.moderationUpstreamModel}
                onChange={(event) =>
                  onChange({ ...form, moderationUpstreamModel: event.target.value })
                }
              />
            </FieldShell>
            <FieldShell
              label={t("admin.providerModerationEndpoint")}
              help={t("admin.providerModerationEndpointHelp")}
            >
              <input
                aria-label={t("admin.providerModerationEndpoint")}
                className={`${inputClass} font-mono`}
                disabled={!form.moderationEnabled}
                value={form.moderationEndpointPath}
                onChange={(event) =>
                  onChange({ ...form, moderationEndpointPath: event.target.value })
                }
              />
            </FieldShell>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={toggleInlineClass}>
              <span>{t("admin.providerModerationSupportsText")}</span>
              <input
                aria-label={t("admin.providerModerationSupportsText")}
                checked={form.moderationSupportsText}
                className={checkboxClass}
                disabled={!form.moderationEnabled}
                type="checkbox"
                onChange={(event) =>
                  onChange({ ...form, moderationSupportsText: event.target.checked })
                }
              />
            </label>
            <label className={toggleInlineClass}>
              <span>{t("admin.providerModerationSupportsImage")}</span>
              <input
                aria-label={t("admin.providerModerationSupportsImage")}
                checked={form.moderationSupportsImage}
                className={checkboxClass}
                disabled={!form.moderationEnabled}
                type="checkbox"
                onChange={(event) =>
                  onChange({ ...form, moderationSupportsImage: event.target.checked })
                }
              />
            </label>
          </div>
          {form.moderationEnabled &&
          !form.moderationSupportsText &&
          !form.moderationSupportsImage ? (
            <p className="text-xs font-semibold text-rose-700" role="alert">
              {t("admin.providerModerationSupportRequired")}
            </p>
          ) : null}
        </div>
      </FormGroup>

      <FormGroup
        title={t("admin.providerAccountGroup.test")}
        description={t("admin.providerAccountDiagnosticsHelp")}
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {testableCapabilities.length > 1 ? (
            <FieldShell label="测试能力 / Test capability" help="">
              <select
                className={inputClass}
                aria-label="测试能力 / Test capability"
                value={selectedTestCapability}
                onChange={(event) =>
                  onChange({
                    ...form,
                    testCapability: event.target.value as ProviderAccountTestCapability | ""
                  })
                }
              >
                <option value="">请选择 / Select</option>
                {testableCapabilities.map((capability) => (
                  <option key={capability} value={capability}>
                    {capability === "chat" ? "聊天 / Chat" : "图像 / Image"}
                  </option>
                ))}
              </select>
            </FieldShell>
          ) : (
            <div className="flex items-end text-xs font-semibold text-slate-600">
              测试能力 / Test capability: {selectedTestCapability || "无 / None"}
            </div>
          )}
          <FieldShell label={t("admin.testModel")} help={t("admin.testModelHelp")}>
            <input
              className={`${inputClass} font-mono`}
              placeholder="claude-3-5-haiku-latest"
              value={form.testModel}
              onChange={(event) => onChange({ ...form, testModel: event.target.value })}
            />
          </FieldShell>
          <div className="flex items-end">
            <button
              className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-50 disabled:text-slate-300"
              type="button"
              disabled={testDisabled || capabilityTestDisabled}
              onClick={onTest}
            >
              <PlugZap className="size-3.5" aria-hidden="true" />
              {testLabel}
            </button>
          </div>
        </div>
        {selectedTestCapability === "image" ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            图像测试会发起一次真实上游生图请求，可能产生上游费用。
          </p>
        ) : null}
        {testResult ? (
          <ProviderAccountTestResultCard result={testResult} className="" />
        ) : null}
      </FormGroup>

      <FormGroup title={t("admin.providerAccountGroup.advanced")}>
        <div className="grid gap-3">
          <p className="text-xs leading-5 text-slate-500">
            {t("admin.advancedJsonCaution")}
          </p>
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
            <AdminAdvancedJsonEditor
              label={t("admin.headersJson")}
              help={
                editMode && hasSavedCustomHeaders
                  ? t("admin.customHeadersConfiguredHelp")
                  : t("admin.headersJsonHelp")
              }
              inputClass={inputClass}
              placeholder={`{"X-Provider":"value"}`}
              value={form.headersJson}
              onChange={(headersJson) => onChange({ ...form, headersJson })}
            />
            <AdminAdvancedJsonEditor
              label={t("admin.configJson")}
              help={t("admin.configJsonHelp")}
              inputClass={inputClass}
              placeholder={`{"testModel":"claude-3-5-haiku-latest","requestFormat":"anthropic"}`}
              value={form.configJson}
              onChange={(configJson) => onChange({ ...form, configJson })}
            />
          </div>
          <FieldShell label={t("admin.notes")} help="">
            <textarea
              className={inputClass}
              placeholder={t("admin.notes")}
              rows={2}
              value={form.notes}
              onChange={(event) => onChange({ ...form, notes: event.target.value })}
            />
          </FieldShell>
          <div className="text-xs leading-5 text-slate-500">
            {t("admin.apiKeySecurityHelp")} {t("admin.jsonObjectHelp")}
          </div>
        </div>
      </FormGroup>
    </div>
  );
}

function ProviderAccountTestResultInline({
  result
}: {
  result: ProviderAccountTestResult | undefined;
}) {
  const { t } = useI18n();

  if (!result) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <AdminStatusBadge tone={result.status === "success" ? "emerald" : "rose"}>
        {result.status === "success"
          ? t("admin.providerAccountTestSuccess")
          : t("admin.providerAccountTestFailedShort")}
      </AdminStatusBadge>
      <span className="truncate text-xs text-slate-500" title={result.message}>
        {result.message}
      </span>
    </div>
  );
}

function ProviderAccountTestResultCard({
  result,
  className
}: {
  result: ProviderAccountTestResult | undefined;
  className: string;
}) {
  const { t } = useI18n();

  if (!result) return null;

  return (
    <div
      className={
        result.status === "success"
          ? `rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 ${className}`
          : `rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 ${className}`
      }
    >
      {result.errorCode?.startsWith("GLOBAL_ADMIN_PROVIDER_TEST_BUDGET") ||
      result.errorCode === "ADMIN_PROVIDER_TEST_COST_EXCEEDED" ? (
        <div className="mb-1 font-semibold text-amber-800">
          Platform test budget denied / 平台测试预算拒绝
        </div>
      ) : null}
      <div>{result.message}</div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-normal">
        {result.capability ? (
          <span>
            测试能力 / Test capability: {result.capability}
          </span>
        ) : null}
        {result.imageTransport ? (
          <span>
            imageTransport: {result.imageTransport}
          </span>
        ) : null}
        {result.model ? (
          <span className="font-mono">
            {t("admin.testModel")}: {result.model}
          </span>
        ) : null}
        {typeof result.latencyMs === "number" ? (
          <span>
            {t("admin.latency")}: {result.latencyMs}ms
          </span>
        ) : null}
        {result.requestFormat ? (
          <span>
            {t("admin.requestFormat")}: {t(`admin.requestFormat.${result.requestFormat}`)}
          </span>
        ) : null}
        {result.authMode ? (
          <span>
            {t("admin.anthropicAuthMode")}: {t(`admin.anthropicAuthMode.${result.authMode}`)}
          </span>
        ) : null}
        {result.endpointPath ? (
          <span className="font-mono">
            {t("admin.endpointPath")}: {result.endpointPath}
          </span>
        ) : null}
        {typeof result.statusCode === "number" ? (
          <span>
            {t("admin.upstreamStatusCode")}: {result.statusCode}
          </span>
        ) : null}
        {typeof result.routeEnabled === "boolean" ? (
          <span>routeEnabled: {String(result.routeEnabled)}</span>
        ) : null}
        {typeof result.providerEnabled === "boolean" ? (
          <span>providerEnabled: {String(result.providerEnabled)}</span>
        ) : null}
      </div>
      {result.status === "error" && typeof result.statusCode === "number" ? (
        <div className="mt-1 font-normal">
          {getProviderAccountStatusHint(result.statusCode, t)}
        </div>
      ) : null}
    </div>
  );
}

function formatBaseUrlSummary(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
  } catch {
    return trimmed.replace(/\/\/[^/@]+@/, "//").replace(/[?#].*$/, "");
  }
}

function getProviderAccountStatusHint(
  statusCode: number,
  t: (key: string) => string
): string {
  if (statusCode === 401 || statusCode === 403) {
    return t("admin.providerAccountStatusAuthHint");
  }

  if (statusCode === 404) {
    return t("admin.providerAccountStatusPathHint");
  }

  if (statusCode === 400) {
    return t("admin.providerAccountStatusModelHint");
  }

  return "";
}

export function providerAccountToForm(
  account: AiProviderAccountSummary
): ProviderAccountFormState {
  const configJson = account.configJson;
  const testableCapabilities = getProviderTestableCapabilities(
    account.capabilities
  );
  const configuredTestCapability = testableCapabilities.includes(
    account.configJson?.testCapability as ProviderAccountTestCapability
  )
    ? (account.configJson?.testCapability as ProviderAccountTestCapability)
    : "";
  const requestFormat = readRequestFormatFromConfig(
    configJson,
    account.providerType
  );
  const moderation = readProviderModerationForm(configJson);

  return {
    name: account.name,
    providerType: account.providerType,
    requestFormat,
    anthropicAuthMode: readAnthropicAuthModeFromConfig(
      configJson,
      account.providerType,
      requestFormat
    ),
    messagesPath:
      readStringConfigValue(configJson, "messagesPath") ||
      readStringConfigValue(configJson, "anthropicMessagesPath"),
    testModel:
      readStringConfigValue(configJson, "testModel") ||
      readStringConfigValue(configJson, "model"),
    testCapability:
      testableCapabilities.length === 1
        ? testableCapabilities[0] ?? ""
        : configuredTestCapability,
    baseUrl: account.baseUrl,
    apiKey: "",
    capabilitiesText: account.capabilities.join(", "),
    enabled: account.enabled,
    priority: String(account.priority),
    timeoutMs: String(account.timeoutMs),
    headersJson: "",
    configJson: stringifyJson(account.configJson),
    notes: account.notes ?? "",
    moderationEnabled: moderation.enabled,
    moderationRequestFormat: moderation.requestFormat,
    moderationUpstreamModel: moderation.upstreamModel,
    moderationEndpointPath: moderation.endpointPath,
    moderationSupportsText: moderation.supportsText,
    moderationSupportsImage: moderation.supportsImage
  };
}

function stringifyJson(value: Record<string, unknown> | null): string {
  return value ? JSON.stringify(value, null, 2) : "";
}
