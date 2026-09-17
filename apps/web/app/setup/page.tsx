"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Database,
  Globe,
  Key,
  Lock,
  Plus,
  Server,
  Settings,
  Shield,
  ShoppingCart,
  Trash2,
  UserPlus,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import { apiUrl } from "../../lib/site-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SetupStatus {
  setupCompleted: boolean;
  databaseConnected: boolean;
  jwtSecretConfigured: boolean;
  paymentSecretConfigured: boolean;
  setupTokenConfigured: boolean;
  apiBaseUrlConfigured: boolean;
  corsOriginsConfigured: boolean;
  hasAiConfig: boolean;
  adminExists: boolean;
  enabledModelCount: number;
  defaultModel: string;
  defaultModelEnabled: boolean;
  hasSiteConfig: boolean;
  planCount: number;
  requiredComplete: boolean;
}

type WizardStep =
  | "system-check"
  | "setup-token"
  | "create-admin"
  | "ai-provider"
  | "models"
  | "site-basics"
  | "finalize";

interface SetupModel {
  _key: string;
  name: string;
  modelId: string;
  provider: string;
  group: string;
  creditCost: number;
}

function modelKey(): string {
  return `m_${Math.random().toString(36).slice(2, 9)}`;
}

const STEPS: Array<{ id: WizardStep; labelKey: string; required: boolean }> = [
  { id: "system-check", labelKey: "setup.step.systemCheck", required: true },
  { id: "setup-token", labelKey: "setup.step.setupToken", required: true },
  { id: "create-admin", labelKey: "setup.step.createAdmin", required: true },
  { id: "ai-provider", labelKey: "setup.step.aiProvider", required: true },
  { id: "models", labelKey: "setup.step.models", required: true },
  { id: "site-basics", labelKey: "setup.step.siteBasics", required: false },
  { id: "finalize", labelKey: "setup.step.finalize", required: true }
];

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        ok ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
      }`}
    >
      {ok ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ steps, currentStep }: { steps: typeof STEPS; currentStep: WizardStep }) {
  const { t } = useI18n();
  const currentIdx = steps.findIndex((s) => s.id === currentStep);

  return (
    <nav className="mb-8" aria-label={t("setup.steps")}>
      <ol className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
        {steps.map((step, idx) => {
          const isActive = idx === currentIdx;
          const isDone = idx < currentIdx;

          return (
            <li key={step.id} className="flex items-center gap-2">
              {idx > 0 ? <ChevronRight className="size-3 text-slate-300" /> : null}
              <span
                className={
                  isActive
                    ? "inline-flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1 text-white"
                    : isDone
                      ? "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-emerald-700"
                      : "inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1"
                }
              >
                {isDone ? <Check className="size-3" /> : <span className="text-[10px]">{idx + 1}</span>}
                {t(step.labelKey)}
                {step.required ? null : (
                  <span className="text-[10px] opacity-70">{t("setup.optional")}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function CheckRow({
  icon: Icon,
  label,
  ok,
  sub,
  statusLabel
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  ok: boolean;
  sub?: string;
  statusLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-slate-400" />
        <span className={ok ? "text-slate-700" : "text-slate-500"}>{label}</span>
        {sub ? <span className="text-xs text-slate-400">{sub}</span> : null}
      </div>
      <StatusBadge ok={ok} label={statusLabel ?? (ok ? "OK" : "!")} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SetupPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState<WizardStep>("system-check");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Form state — admin
  const [setupToken, setSetupToken] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminConfirmPassword, setAdminConfirmPassword] = useState("");

  // Form state — AI provider
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");

  // Form state — models
  const [models, setModels] = useState<SetupModel[]>([
    { _key: modelKey(), name: "", modelId: "", provider: "OPENAI_COMPATIBLE", group: "general", creditCost: 0 }
  ]);

  // Form state — site basics
  const [siteName, setSiteName] = useState("");
  const [siteAnnouncement, setSiteAnnouncement] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  // -----------------------------------------------------------------------
  // Resolve which steps are active (skip if pre-configured)
  // -----------------------------------------------------------------------

  const activeSteps = React.useMemo(() => {
    if (!status) return STEPS;
    return STEPS.filter((step) => {
      if (step.id === "setup-token" && !status.setupTokenConfigured) return false;
      if (step.id === "create-admin" && status.adminExists) return false;
      return true;
    });
  }, [status]);

  const activeStepIds = React.useMemo(() => new Set(activeSteps.map((s) => s.id)), [activeSteps]);

  // -----------------------------------------------------------------------
  // Navigation helpers
  // -----------------------------------------------------------------------

  function nextStep() {
    const visible = activeSteps;
    const idx = visible.findIndex((s) => s.id === currentStep);
    if (idx < visible.length - 1) {
      setCurrentStep(visible[idx + 1]!.id);
    }
  }

  function prevStep() {
    const visible = activeSteps;
    const idx = visible.findIndex((s) => s.id === currentStep);
    if (idx > 0) {
      setCurrentStep(visible[idx - 1]!.id);
    }
  }

  // -----------------------------------------------------------------------
  // Load status and auto-redirect
  // -----------------------------------------------------------------------

  const setupStatusUrl = apiUrl("/setup/status");

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(setupStatusUrl);
      const data = (await res.json()) as SetupStatus;
      setStatus(data);

      if (data.setupCompleted) {
        router.replace("/");
        return;
      }

      // Determine initial step based on what's already configured
      if (currentStep === "system-check") {
        // Stay on system-check (it's always first)
      }
    } catch {
      setError(`${t("setup.loadFailed")} — ${setupStatusUrl}`);
    } finally {
      setLoading(false);
    }
  }, [setupStatusUrl, currentStep, router, t]);

  useEffect(() => {
    void loadStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // -----------------------------------------------------------------------
  // Model helpers
  // -----------------------------------------------------------------------

  function addModel() {
    setModels((prev) => [
      ...prev,
      { _key: modelKey(), name: "", modelId: "", provider: "OPENAI_COMPATIBLE", group: "general", creditCost: 0 }
    ]);
  }

  function removeModel(key: string) {
    setModels((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((m) => m._key !== key);
    });
  }

  function updateModel(key: string, field: keyof SetupModel, value: string | number) {
    setModels((prev) =>
      prev.map((m) => (m._key === key ? { ...m, [field]: value } : m))
    );
  }

  // -----------------------------------------------------------------------
  // Finalize
  // -----------------------------------------------------------------------

  async function finalize() {
    setSaving(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {};

      // Setup token
      if (status?.setupTokenConfigured) {
        body.setupToken = setupToken;
      }

      // Admin
      if (!status?.adminExists) {
        if (!adminEmail || !adminPassword || adminPassword.length < 8) {
          setError(t("setup.invalidAdmin"));
          setSaving(false);
          return;
        }
        if (adminPassword !== adminConfirmPassword) {
          setError(t("setup.passwordMismatch"));
          setSaving(false);
          return;
        }
        body.adminEmail = adminEmail;
        body.adminPassword = adminPassword;
      }

      // AI provider
      if (aiBaseUrl.trim()) {
        body.aiBaseUrl = aiBaseUrl.trim();
        body.aiApiKey = aiApiKey.trim();
      }

      // Models (filter out empty/incomplete entries)
      const validModels = models.filter((m) => m.name.trim() && m.modelId.trim());
      if (validModels.length > 0) {
        body.models = validModels.map((m, i) => ({
          name: m.name.trim(),
          modelId: m.modelId.trim(),
          provider: m.provider,
          group: m.group || "general",
          creditCost: m.creditCost ?? 0,
          isRecommended: i === 0,
          sortOrder: i
        }));
      }

      // Site basics (optional)
      if (siteName.trim()) {
        body.siteName = siteName.trim();
      }
      if (siteAnnouncement.trim()) {
        body.siteAnnouncement = siteAnnouncement.trim();
      }
      if (contactEmail.trim()) {
        body.contactEmail = contactEmail.trim();
      }

      const res = await fetch(apiUrl("/setup/configure"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const text = await res.text();
        let msg = t("setup.finalizeFailed");
        try {
          const parsed = JSON.parse(text) as { message?: string };
          if (parsed.message) msg = parsed.message;
        } catch { /* use fallback */ }
        throw new Error(msg);
      }

      setMessage(t("setup.completed"));
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("setup.finalizeFailed"));
    } finally {
      setSaving(false);
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">{t("admin.loading")}</p>
      </div>
    );
  }

  const currentVisibleIdx = activeSteps.findIndex((s) => s.id === currentStep);
  const progressPercent = Math.round(
    ((currentVisibleIdx + 1) / activeSteps.length) * 100
  );

  const isLastStep = currentVisibleIdx === activeSteps.length - 1;

  return (
    <div className="flex min-h-[100dvh] items-start justify-center bg-slate-50 px-4 py-8 sm:items-center sm:py-12">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm">
            <Settings className="size-6" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold text-slate-950">{t("setup.title")}</h1>
          <p className="mt-2 text-sm text-slate-500">{t("setup.description")}</p>
          {/* Progress bar */}
          <div className="mx-auto mt-4 h-1.5 w-48 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {currentVisibleIdx + 1} / {activeSteps.length}
          </p>
        </div>

        {/* Step indicator */}
        <StepIndicator steps={activeSteps} currentStep={currentStep} />

        {/* Error / message */}
        {error ? (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {message}
          </div>
        ) : null}

        {/* Main card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {/* ============================================================
              Step: System Check
              ============================================================ */}
          {currentStep === "system-check" && status ? (
            <div className="grid gap-4">
              <h2 className="text-lg font-semibold text-slate-950">{t("setup.step.systemCheck")}</h2>
              <p className="text-sm text-slate-500">{t("setup.systemCheckDesc")}</p>

              <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <CheckRow icon={Database} label={t("setup.databaseConnected")} ok={status.databaseConnected} />
                <CheckRow icon={Key} label={t("setup.jwtSecret")} ok={status.jwtSecretConfigured} />
                <CheckRow icon={Globe} label={t("setup.apiBaseUrl")} ok={status.apiBaseUrlConfigured} />
                <CheckRow icon={Server} label={t("setup.corsOrigins")} ok={status.corsOriginsConfigured} />
                <CheckRow icon={Lock} label={t("setup.paymentSecret")} ok={status.paymentSecretConfigured} />
                <CheckRow icon={Shield} label={t("setup.setupToken")} ok={status.setupTokenConfigured} sub={status.setupTokenConfigured ? t("setup.configured") : t("setup.optional")} />
              </div>

              {!status.databaseConnected ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 leading-6">
                  <p className="font-semibold">{t("setup.dbFailed")}</p>
                  <p className="mt-1">{t("setup.dbFailedDesc")}</p>
                  <code className="mt-1 block rounded bg-red-100 px-2 py-1 font-mono">
                    mysql://user:password@127.0.0.1:3306/ai_aggregate_site
                  </code>
                </div>
              ) : null}

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 leading-6">
                <p className="font-semibold text-slate-700">{t("setup.minimalEnvChecklist")}</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  <li>DATABASE_URL</li>
                  <li>JWT_SECRET</li>
                  <li>NEXT_PUBLIC_API_BASE_URL</li>
                  <li>CORS_ORIGINS</li>
                  <li>PAYMENT_SETTINGS_SECRET ({t("setup.recommended")})</li>
                  <li>SETUP_TOKEN ({t("setup.recommendedForPublic")})</li>
                </ul>
              </div>
            </div>
          ) : null}

          {/* ============================================================
              Step: Setup Token
              ============================================================ */}
          {currentStep === "setup-token" && status?.setupTokenConfigured ? (
            <div className="grid gap-4">
              <h2 className="text-lg font-semibold text-slate-950">{t("setup.step.setupToken")}</h2>
              <p className="text-sm text-slate-500">{t("setup.setupTokenDesc")}</p>
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                {t("setup.setupTokenLabel")}
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-950 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                  type="password"
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                  placeholder="••••••••"
                />
              </label>
            </div>
          ) : null}

          {/* ============================================================
              Step: Create Admin
              ============================================================ */}
          {currentStep === "create-admin" && !status?.adminExists ? (
            <div className="grid gap-4">
              <h2 className="text-lg font-semibold text-slate-950">{t("setup.step.createAdmin")}</h2>
              <p className="text-sm text-slate-500">{t("setup.createAdminDesc")}</p>
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                {t("login.email")}
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-950 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="admin@example.com"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                {t("login.password")}
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-950 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder={t("login.passwordPlaceholder")}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                {t("setup.confirmPassword")}
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-950 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                  type="password"
                  value={adminConfirmPassword}
                  onChange={(e) => setAdminConfirmPassword(e.target.value)}
                  placeholder={t("setup.confirmPasswordPlaceholder")}
                />
              </label>
            </div>
          ) : currentStep === "create-admin" && status?.adminExists ? (
            <div className="grid gap-4">
              <h2 className="text-lg font-semibold text-slate-950">{t("setup.step.createAdmin")}</h2>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <CheckCircle2 className="mr-2 inline-block size-4" />
                {t("setup.adminAlreadyExists")}
              </div>
            </div>
          ) : null}

          {/* ============================================================
              Step: AI Provider
              ============================================================ */}
          {currentStep === "ai-provider" ? (
            <div className="grid gap-4">
              <h2 className="text-lg font-semibold text-slate-950">{t("setup.step.aiProvider")}</h2>
              <p className="text-sm text-slate-500">{t("setup.aiProviderDesc")}</p>

              {status?.hasAiConfig ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <CheckCircle2 className="mr-2 inline-block size-4" />
                  {t("setup.aiProviderAlreadyConfigured")}
                </div>
              ) : null}

              <label className="grid gap-2 text-sm font-medium text-slate-700">
                {t("setup.aiBaseUrlLabel")}
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-950 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                  type="url"
                  value={aiBaseUrl}
                  onChange={(e) => setAiBaseUrl(e.target.value)}
                  placeholder="https://your-ai-gateway.example.com/v1"
                />
                <span className="text-xs font-normal text-slate-400">{t("setup.aiBaseUrlHint")}</span>
              </label>

              <label className="grid gap-2 text-sm font-medium text-slate-700">
                {t("setup.aiApiKeyLabel")}
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-950 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                  type="password"
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                  placeholder="sk-••••••••"
                />
                <span className="text-xs font-normal text-slate-400">{t("setup.aiApiKeyHint")}</span>
              </label>
            </div>
          ) : null}

          {/* ============================================================
              Step: Models
              ============================================================ */}
          {currentStep === "models" ? (
            <div className="grid gap-4">
              <h2 className="text-lg font-semibold text-slate-950">{t("setup.step.models")}</h2>
              <p className="text-sm text-slate-500">{t("setup.modelsDesc")}</p>

              {status && status.enabledModelCount > 0 ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <CheckCircle2 className="mr-2 inline-block size-4" />
                  {t("setup.modelsAlreadyExist", { count: status.enabledModelCount })}
                </div>
              ) : null}

              <div className="grid gap-4">
                {models.map((model, idx) => (
                  <div key={model._key} className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500">
                        {t("setup.modelEntry", { n: idx + 1 })}
                      </span>
                      {models.length > 1 ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-600 transition hover:bg-red-50"
                          onClick={() => removeModel(model._key)}
                        >
                          <Trash2 className="size-3" />
                          {t("setup.removeModel")}
                        </button>
                      ) : null}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs font-medium text-slate-600">
                        {t("setup.modelDisplayName")}
                        <input
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-950 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                          type="text"
                          value={model.name}
                          onChange={(e) => updateModel(model._key, "name", e.target.value)}
                          placeholder={t("setup.modelNamePlaceholder")}
                        />
                      </label>

                      <label className="grid gap-1 text-xs font-medium text-slate-600">
                        {t("setup.modelIdLabel")}
                        <input
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-950 font-mono outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                          type="text"
                          value={model.modelId}
                          onChange={(e) => updateModel(model._key, "modelId", e.target.value)}
                          placeholder="openai/gpt-oss-120b:free"
                        />
                      </label>

                      <label className="grid gap-1 text-xs font-medium text-slate-600">
                        {t("setup.modelProvider")}
                        <select
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-950 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                          value={model.provider}
                          onChange={(e) => updateModel(model._key, "provider", e.target.value)}
                        >
                          <option value="OPENAI_COMPATIBLE">OpenAI Compatible</option>
                          <option value="SUB2API">Sub2API</option>
                          <option value="NEW_API">New API</option>
                        </select>
                      </label>

                      <label className="grid gap-1 text-xs font-medium text-slate-600">
                        {t("setup.modelGroup")}
                        <input
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-950 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                          type="text"
                          value={model.group}
                          onChange={(e) => updateModel(model._key, "group", e.target.value)}
                          placeholder="general"
                        />
                      </label>

                      <label className="grid gap-1 text-xs font-medium text-slate-600">
                        {t("setup.modelCreditCost")}
                        <input
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-950 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                          type="number"
                          min={0}
                          value={model.creditCost}
                          onChange={(e) => updateModel(model._key, "creditCost", Math.max(0, parseInt(e.target.value, 10) || 0))}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600"
                onClick={addModel}
              >
                <Plus className="size-4" />
                {t("setup.addModel")}
              </button>
            </div>
          ) : null}

          {/* ============================================================
              Step: Site Basics (optional)
              ============================================================ */}
          {currentStep === "site-basics" ? (
            <div className="grid gap-4">
              <h2 className="text-lg font-semibold text-slate-950">{t("setup.step.siteBasics")}</h2>
              <p className="text-sm text-slate-500">{t("setup.siteBasicsDesc")}</p>

              <label className="grid gap-2 text-sm font-medium text-slate-700">
                {t("setup.siteNameLabel")}
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-950 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                  type="text"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder={t("setup.siteNamePlaceholder")}
                />
              </label>

              <label className="grid gap-2 text-sm font-medium text-slate-700">
                {t("setup.contactEmailLabel")}
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-950 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="contact@example.com"
                />
              </label>

              <label className="grid gap-2 text-sm font-medium text-slate-700">
                {t("setup.siteAnnouncementLabel")}
                <textarea
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-950 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                  rows={3}
                  value={siteAnnouncement}
                  onChange={(e) => setSiteAnnouncement(e.target.value)}
                  placeholder={t("setup.siteAnnouncementPlaceholder")}
                />
              </label>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                <CheckCircle2 className="mr-1 inline-block size-3.5 text-slate-400" />
                {t("setup.siteBasicsSkipHint")}
              </div>
            </div>
          ) : null}

          {/* ============================================================
              Step: Finalize
              ============================================================ */}
          {currentStep === "finalize" && status ? (
            <div className="grid gap-4">
              <h2 className="text-lg font-semibold text-slate-950">{t("setup.step.finalize")}</h2>
              <p className="text-sm text-slate-500">{t("setup.finalizeDesc")}</p>

              <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <CheckRow icon={Database} label={t("setup.databaseConnected")} ok={status.databaseConnected} />
                <CheckRow icon={Key} label={t("setup.jwtSecret")} ok={status.jwtSecretConfigured} />
                <CheckRow icon={UserPlus} label={t("setup.adminAccount")} ok={status.adminExists || adminEmail.trim() !== ""} />
                <CheckRow
                  icon={Server}
                  label={t("setup.aiProvider")}
                  ok={status.hasAiConfig || aiBaseUrl.trim() !== ""}
                />
                <CheckRow
                  icon={Globe}
                  label={t("setup.modelsEnabled", { count: status.enabledModelCount || models.filter((m) => m.name.trim() && m.modelId.trim()).length })}
                  ok={status.enabledModelCount > 0 || models.some((m) => m.name.trim() && m.modelId.trim())}
                />
                <CheckRow
                  icon={CheckCircle2}
                  label={t("setup.defaultModelConfigured")}
                  ok={status.defaultModelEnabled || (status.enabledModelCount === 0 && models.some((m) => m.name.trim() && m.modelId.trim()))}
                  sub={status.defaultModelEnabled ? (status.defaultModel || "-") : (models[0]?.modelId || t("setup.willBeCreated"))}
                />
                <CheckRow icon={Settings} label={t("setup.siteConfigured")} ok={status.hasSiteConfig || siteName.trim() !== ""} sub={status.hasSiteConfig ? t("setup.configured") : `${t("setup.optional")} / ${t("setup.skippable")}`} />
                <CheckRow
                  icon={ShoppingCart}
                  label={t("setup.plansConfigured")}
                  ok={status.planCount > 0}
                  statusLabel={status.planCount > 0 ? "OK" : t("setup.warningLabel")}
                  sub={
                    status.planCount > 0
                      ? `${status.planCount} ${t("workspace.plans")}`
                      : `${t("setup.optional")} / ${t("setup.skippable")} · ${t("setup.planWarning")}`
                  }
                />
                <CheckRow icon={ShoppingCart} label={t("setup.paymentConfigured")} ok={status.paymentSecretConfigured} sub={status.paymentSecretConfigured ? t("setup.canConfigure") : t("setup.warning")} />
              </div>

              {!status.requiredComplete ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="mr-2 inline-block size-4" />
                  {t("setup.requiredIncomplete")}
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <CheckCircle2 className="mr-2 inline-block size-4" />
                  {t("setup.readyToComplete")}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <div>
            {currentVisibleIdx > 0 ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={prevStep}
              >
                <ArrowLeft className="size-4" />
                {t("setup.back")}
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            {/* Skip button for optional steps */}
            {currentStep === "site-basics" ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-50"
                onClick={nextStep}
              >
                {t("setup.skip")}
                <ArrowRight className="size-4" />
              </button>
            ) : null}

            {!isLastStep ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                onClick={nextStep}
              >
                {t("setup.next")}
                <ArrowRight className="size-4" />
              </button>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:bg-slate-300"
                disabled={saving}
                onClick={() => void finalize()}
              >
                {saving ? t("admin.saving") : t("setup.completeSetup")}
                <Check className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/* Help link */}
        <div className="mt-6 text-center">
          <Link
            href="/admin"
            className="text-xs text-slate-400 transition hover:text-indigo-600"
          >
            {t("setup.adminLoginHint")}
          </Link>
        </div>
      </div>
    </div>
  );
}
