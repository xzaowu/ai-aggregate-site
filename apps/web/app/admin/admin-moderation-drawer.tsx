"use client";

import type { AiProviderAccountSummary } from "@ai-aggregate/shared";
import React from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import {
  isProviderModerationDeclared,
  type ModerationRouteFormState
} from "./admin-moderation";
import {
  AdminDrawer,
  AdminDrawerBody,
  AdminDrawerFooter,
  AdminDrawerHeader
} from "./admin-layout";

export interface AdminModerationDrawerProps {
  open: boolean;
  mode: "create" | "edit";
  form: ModerationRouteFormState;
  accounts: AiProviderAccountSummary[];
  inputClass: string;
  checkboxClass: string;
  toggleInlineClass: string;
  primaryButtonClass: string;
  iconButtonClass: string;
  busy: boolean;
  error: string | null;
  onChange: (form: ModerationRouteFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function AdminModerationDrawer({
  open,
  mode,
  form,
  accounts,
  inputClass,
  checkboxClass,
  toggleInlineClass,
  primaryButtonClass,
  iconButtonClass,
  busy,
  error,
  onChange,
  onClose,
  onSubmit
}: AdminModerationDrawerProps) {
  const { t } = useI18n();
  const closeLabel = t("admin.closeModerationDrawer");
  const accountOptions = [...accounts].sort((left, right) => {
    const leftPriority = isProviderModerationDeclared(left) ? 0 : 1;
    const rightPriority = isProviderModerationDeclared(right) ? 0 : 1;
    return leftPriority - rightPriority;
  });

  return (
    <AdminDrawer open={open} onClose={onClose} closeLabel={closeLabel}>
      <AdminDrawerHeader
        closeLabel={closeLabel}
        description={t("admin.moderationDrawerDescription")}
        iconButtonClass={iconButtonClass}
        title={
          mode === "create"
            ? t("admin.createModerationRoute")
            : t("admin.editModerationRoute")
        }
        onClose={onClose}
      />
      <AdminDrawerBody>
        <div className="grid min-w-0 gap-5">
          <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4">
            <h4 className="text-xs font-semibold uppercase text-slate-500">
              {t("admin.moderationRouteConfiguration")}
            </h4>
            <Field
              label={t("admin.moderationProviderAccount")}
              help={t("admin.moderationProviderAccountHelp")}
            >
              <select
                aria-label={t("admin.moderationProviderAccount")}
                className={inputClass}
                value={form.providerAccountId}
                onChange={(event) =>
                  onChange({ ...form, providerAccountId: event.target.value })
                }
              >
                <option value="">{t("admin.selectProviderAccount")}</option>
                {accountOptions.map((account) => {
                  const declared = isProviderModerationDeclared(account);
                  return (
                    <option
                      key={account.id}
                      disabled={!declared}
                      value={account.id}
                    >
                      {account.name} ({account.providerType}) · {account.enabled
                        ? t("admin.enabled")
                        : t("admin.disabled")} · {declared
                        ? t("admin.providerModerationCompatible")
                        : t("admin.providerModerationUndeclared")}
                    </option>
                  );
                })}
              </select>
            </Field>
            <div className="grid gap-4 lg:grid-cols-2">
              <Field
                label={t("admin.moderationUpstreamModel")}
                help={t("admin.moderationUpstreamModelHelp")}
              >
                <input
                  aria-label={t("admin.moderationUpstreamModel")}
                  className={`${inputClass} font-mono`}
                  value={form.upstreamModel}
                  onChange={(event) =>
                    onChange({ ...form, upstreamModel: event.target.value })
                  }
                />
              </Field>
              <Field
                label={t("admin.moderationEndpointPath")}
                help={t("admin.moderationEndpointPathHelp")}
              >
                <input
                  aria-describedby={error ? "moderation-route-form-error" : undefined}
                  aria-label={t("admin.moderationEndpointPath")}
                  className={`${inputClass} font-mono`}
                  value={form.endpointPath}
                  onChange={(event) =>
                    onChange({ ...form, endpointPath: event.target.value })
                  }
                />
              </Field>
              <Field
                label={t("admin.moderationPriority")}
                help={t("admin.moderationPriorityHelp")}
              >
                <input
                  aria-label={t("admin.moderationPriority")}
                  className={inputClass}
                  inputMode="numeric"
                  min={1}
                  type="number"
                  value={form.priority}
                  onChange={(event) =>
                    onChange({ ...form, priority: event.target.value })
                  }
                />
              </Field>
              <Field
                label={t("admin.moderationTimeout")}
                help={t("admin.moderationTimeoutHelp")}
              >
                <input
                  aria-label={t("admin.moderationTimeout")}
                  className={inputClass}
                  inputMode="numeric"
                  min={500}
                  max={10000}
                  placeholder={t("admin.moderationTimeoutInherited")}
                  type="number"
                  value={form.timeoutMs}
                  onChange={(event) =>
                    onChange({ ...form, timeoutMs: event.target.value })
                  }
                />
              </Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={toggleInlineClass}>
                <span>{t("admin.providerModerationSupportsText")}</span>
                <input
                  aria-label={t("admin.providerModerationSupportsText")}
                  checked={form.supportsText}
                  className={checkboxClass}
                  type="checkbox"
                  onChange={(event) =>
                    onChange({ ...form, supportsText: event.target.checked })
                  }
                />
              </label>
              <label className={toggleInlineClass}>
                <span>{t("admin.providerModerationSupportsImage")}</span>
                <input
                  aria-label={t("admin.providerModerationSupportsImage")}
                  checked={form.supportsImage}
                  className={checkboxClass}
                  type="checkbox"
                  onChange={(event) =>
                    onChange({ ...form, supportsImage: event.target.checked })
                  }
                />
              </label>
            </div>
            <label className={toggleInlineClass}>
              <span>{t("admin.moderationRouteEnabled")}</span>
              <input
                aria-label={t("admin.moderationRouteEnabled")}
                checked={form.enabled}
                className={checkboxClass}
                type="checkbox"
                onChange={(event) =>
                  onChange({ ...form, enabled: event.target.checked })
                }
              />
            </label>
            {error ? (
              <p
                id="moderation-route-form-error"
                className="text-sm font-semibold text-rose-700"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </section>
        </div>
      </AdminDrawerBody>
      <AdminDrawerFooter>
        <div className="flex flex-wrap justify-end gap-2">
          <button className={iconButtonClass} type="button" onClick={onClose}>
            {t("admin.cancel")}
          </button>
          <button
            className={primaryButtonClass}
            disabled={busy}
            type="button"
            onClick={onSubmit}
          >
            {busy ? t("admin.saving") : t("admin.saveModerationRoute")}
          </button>
        </div>
      </AdminDrawerFooter>
    </AdminDrawer>
  );
}

function Field({
  label,
  help,
  children
}: {
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      {children}
      <span className="text-xs leading-5 text-slate-500">{help}</span>
    </label>
  );
}
