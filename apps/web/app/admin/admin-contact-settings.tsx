"use client";

import React from "react";
import {
  Contact,
  Globe,
  Link,
  Mail,
  MessageCircle,
  Plus,
  QrCode,
  Save,
  Trash2
} from "lucide-react";
import { useI18n } from "../../lib/i18n/use-i18n";
import { AdminSection, AdminSectionHeader } from "./admin-layout";

export interface ContactExternalLink {
  label: string;
  url: string;
}

export interface ContactFormState {
  contactDescription: string;
  contactEmail: string;
  contactWechat: string;
  contactPublicAccount: string;
  contactCommunityUrl: string;
  contactQrImageUrl: string;
  contactNotes: string;
  contactExternalLinks: ContactExternalLink[];
}

interface AdminContactSettingsProps {
  form: ContactFormState;
  saving: boolean;
  onChange: (updates: Partial<ContactFormState>) => void;
  onSave: () => void;
}

const controlClass =
  "min-h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100";

export function AdminContactSettings({
  form,
  saving,
  onChange,
  onSave
}: AdminContactSettingsProps) {
  const { t } = useI18n();

  function addLink() {
    if (form.contactExternalLinks.length >= 6) return;
    onChange({
      contactExternalLinks: [...form.contactExternalLinks, { label: "", url: "" }]
    });
  }

  function removeLink(index: number) {
    onChange({
      contactExternalLinks: form.contactExternalLinks.filter((_, i) => i !== index)
    });
  }

  function updateLink(index: number, updates: Partial<ContactExternalLink>) {
    onChange({
      contactExternalLinks: form.contactExternalLinks.map((link, i) =>
        i === index ? { ...link, ...updates } : link
      )
    });
  }

  return (
    <AdminSection>
      <AdminSectionHeader
        title={t("admin.contactSettingsTitle")}
        description={t("admin.contactSettingsDescription")}
      />
      <div className="grid min-w-0 gap-4 bg-slate-50/60 p-4 text-sm lg:grid-cols-2">
        <div className="grid min-w-0 content-start gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <div className="grid min-w-0 gap-1">
            <h3 className="text-sm font-semibold text-slate-950">
              {t("admin.contactSettingsTitle")}
            </h3>
          </div>

          <label className="grid min-w-0 gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-normal text-slate-600">
              <Contact className="size-3.5" aria-hidden="true" />
              {t("admin.contactDescription")}
            </span>
            <textarea
              className={`${controlClass} min-h-28 resize-y leading-6`}
              rows={3}
              value={form.contactDescription}
              onChange={(event) =>
                onChange({ contactDescription: event.target.value })
              }
            />
          </label>

          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <label className="grid min-w-0 gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-normal text-slate-600">
                <Mail className="size-3.5" aria-hidden="true" />
                {t("admin.contactEmail")}
              </span>
              <input
                className={controlClass}
                type="email"
                value={form.contactEmail}
                onChange={(event) =>
                  onChange({ contactEmail: event.target.value })
                }
              />
            </label>

            <label className="grid min-w-0 gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-normal text-slate-600">
                <MessageCircle className="size-3.5" aria-hidden="true" />
                {t("admin.contactWechat")}
              </span>
              <input
                className={controlClass}
                type="text"
                value={form.contactWechat}
                onChange={(event) =>
                  onChange({ contactWechat: event.target.value })
                }
              />
            </label>
          </div>

          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <label className="grid min-w-0 gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-normal text-slate-600">
                <MessageCircle className="size-3.5" aria-hidden="true" />
                {t("admin.contactPublicAccount")}
              </span>
              <input
                className={controlClass}
                type="text"
                value={form.contactPublicAccount}
                onChange={(event) =>
                  onChange({ contactPublicAccount: event.target.value })
                }
              />
            </label>

            <label className="grid min-w-0 gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-normal text-slate-600">
                <Globe className="size-3.5" aria-hidden="true" />
                {t("admin.contactCommunityUrl")}
              </span>
              <input
                className={controlClass}
                type="url"
                value={form.contactCommunityUrl}
                onChange={(event) =>
                  onChange({ contactCommunityUrl: event.target.value })
                }
              />
            </label>
          </div>

          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <label className="grid min-w-0 gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-normal text-slate-600">
                <QrCode className="size-3.5" aria-hidden="true" />
                {t("admin.contactQrImageUrl")}
              </span>
              <input
                className={controlClass}
                type="url"
                value={form.contactQrImageUrl}
                onChange={(event) =>
                  onChange({ contactQrImageUrl: event.target.value })
                }
              />
            </label>

            <label className="grid min-w-0 gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-normal text-slate-600">
                <Contact className="size-3.5" aria-hidden="true" />
                {t("admin.contactNotes")}
              </span>
              <textarea
                className={`${controlClass} min-h-28 resize-y leading-6`}
                rows={3}
                value={form.contactNotes}
                onChange={(event) =>
                  onChange({ contactNotes: event.target.value })
                }
              />
            </label>
          </div>

          <div className="grid min-w-0 gap-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-normal text-slate-600">
              <Link className="size-3.5" aria-hidden="true" />
              {t("admin.contactExternalLinks")}
            </span>

            {form.contactExternalLinks.map((link, index) => (
              <div
                key={index}
                className="flex min-w-0 flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:flex-row sm:items-center"
              >
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                  <input
                    className={controlClass}
                    placeholder={t("admin.contactLinkLabel")}
                    type="text"
                    value={link.label}
                    onChange={(event) =>
                      updateLink(index, { label: event.target.value })
                    }
                  />
                  <input
                    className={controlClass}
                    placeholder={t("admin.contactLinkUrl")}
                    type="url"
                    value={link.url}
                    onChange={(event) =>
                      updateLink(index, { url: event.target.value })
                    }
                  />
                </div>
                <button
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  disabled={saving}
                  type="button"
                  onClick={() => removeLink(index)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  <span className="sr-only">{t("admin.removeContactLink")}</span>
                </button>
              </div>
            ))}

            {form.contactExternalLinks.length < 6 ? (
              <button
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 sm:w-auto"
                disabled={saving}
                type="button"
                onClick={addLink}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t("admin.addContactLink")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:col-span-2">
          <div className="text-xs font-medium text-slate-500" />
          <button
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-600/20 transition hover:bg-indigo-700 disabled:bg-indigo-300 sm:w-auto"
            disabled={saving}
            type="button"
            onClick={onSave}
          >
            <Save className="size-4" aria-hidden="true" />
            {saving ? t("admin.saving") : t("admin.saveContactSettings")}
          </button>
        </div>
      </div>
    </AdminSection>
  );
}

export function contactFormToPayload(form: ContactFormState) {
  return [
    {
      key: "contactDescription",
      value: form.contactDescription.trim(),
      type: "string"
    },
    { key: "contactEmail", value: form.contactEmail.trim(), type: "string" },
    { key: "contactWechat", value: form.contactWechat.trim(), type: "string" },
    {
      key: "contactPublicAccount",
      value: form.contactPublicAccount.trim(),
      type: "string"
    },
    {
      key: "contactCommunityUrl",
      value: form.contactCommunityUrl.trim(),
      type: "string"
    },
    {
      key: "contactQrImageUrl",
      value: form.contactQrImageUrl.trim(),
      type: "string"
    },
    { key: "contactNotes", value: form.contactNotes.trim(), type: "string" },
    {
      key: "contactExternalLinks",
      value: JSON.stringify(form.contactExternalLinks),
      type: "json"
    }
  ];
}
