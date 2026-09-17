"use client";

import type {
  AiModelSummary,
  AuthUser,
  ChatMessage,
  ChatMessageRecord,
  ChatSessionSummary
} from "@ai-aggregate/shared";
import {
  defaultDemoModelId,
  isChatCapableModel,
  normalizeModelDisplaySurfaces
} from "@ai-aggregate/shared";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowDown, Bot, Globe, History, Plus, Search } from "lucide-react";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { ChatComposer } from "./ChatComposer";
import { ChatOutline } from "./ChatOutline";
import { ChatSidebar } from "./ChatSidebar";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState, type PromptSuggestion } from "./EmptyState";
import { ModelIcon } from "./ModelIcon";
import { ModelSelectorDialog } from "./ModelSelectorDialog";
import { resolveSelectedModelDisplayLabel } from "./model-display";
import {
  useOptionalWorkspaceSurface,
  useWorkspaceShellContext,
  type WorkspaceSurface
} from "./workspace-shell-context";
import { Badge } from "./ui";
import { getUserSeed } from "./user-identity";
import { UserAvatar } from "./UserAvatar";
import { resolveModelIdentity } from "./message-model-identity";
import {
  shouldRegenerateTitle,
} from "../../lib/session-title";
import { isNearBottom } from "../../lib/chat-outline";
import {
  coordinateSessionTitle,
  getSessionTitleCompensation,
  hasUserMessage,
  processStreamTitleEvent,
} from "../../lib/chat-title-coordinator";
import {
  parseWorkspacePromptCards,
  resolveWorkspaceHero
} from "./workspace-settings";
import { useI18n } from "../../lib/i18n/use-i18n";
import { usePublicSettings } from "../../lib/use-public-settings";
import {
  buildChatCompletionPayload,
  canSendChatMessage,
  createDeleteSessionNetworkErrorMessage,
  createDeleteSessionRequest,
  createModelChangeState,
  createSessionDeleteState,
  formatModelAccessLabel,
  formatModelCreditCostLabel,
  isChatCompletionStreamResponseUsable,
  parseChatCompletionStreamChunk,
  readResponseErrorMessage,
  releaseChatSendLock,
  resolveRequestModel,
  shouldSubmitOnEnter,
  tryAcquireChatSendLock,
  validateModelBeforeSend
} from "../../lib/chat-send-state";
import { apiUrl, siteConfig } from "../../lib/site-config";
import {
  getPublicLogoText,
  getPublicWorkspaceIconUrl
} from "../../lib/public-branding";
import { CHAT_CONTENT_CLASS_NAME } from "../../lib/chat-layout";
export { AssistantMarkdown } from "./AssistantMarkdown";
const fallbackModel = defaultDemoModelId;
export const imageModelHandoffStorageKey =
  "ai-aggregate:image-selected-model-handoff:v1";
export const chatModelHandoffStorageKey =
  "ai-aggregate:chat-selected-model-handoff:v1";
const chatModelHandoffMaxAgeMs = 5 * 60 * 1000;
const chatDraftStoragePrefix = "ai-aggregate:chat-draft:v1";
const chatScrollStoragePrefix = "ai-aggregate:chat-scroll:v1";

export type ChatScrollSurface = "desktop" | "mobile";

export interface ChatScrollRuntimeState {
  identity: string | null;
  sessionId: string | null;
  shouldFollowDesktopBottom: boolean;
  shouldFollowMobileBottom: boolean;
  lastDesktopScrollTop: number;
  lastMobileScrollTop: number;
  hasDesktopScrollPosition: boolean;
  hasMobileScrollPosition: boolean;
}

export function createChatScrollRuntimeState(
  identity: string | null,
  sessionId: string | null
): ChatScrollRuntimeState {
  return {
    identity,
    sessionId,
    shouldFollowDesktopBottom: true,
    shouldFollowMobileBottom: true,
    lastDesktopScrollTop: 0,
    lastMobileScrollTop: 0,
    hasDesktopScrollPosition: false,
    hasMobileScrollPosition: false
  };
}

export function ownsChatPersistenceIdentity(
  runtimeIdentity: string | null,
  targetIdentity: string | null
): boolean {
  return runtimeIdentity === targetIdentity;
}

export function canPersistChatScrollRuntime(
  runtime: ChatScrollRuntimeState,
  targetIdentity: string | null,
  targetSessionId: string | null,
  surface: ChatScrollSurface
): boolean {
  if (
    !targetIdentity ||
    !targetSessionId ||
    !ownsChatPersistenceIdentity(runtime.identity, targetIdentity) ||
    runtime.sessionId !== targetSessionId
  ) {
    return false;
  }

  return surface === "mobile"
    ? runtime.hasMobileScrollPosition
    : runtime.hasDesktopScrollPosition;
}

export function resetChatScrollRestoreOwnership(
  restoreKeyRefs: Record<ChatScrollSurface, { current: string | null }>,
  ownedSurfaces: readonly ChatScrollSurface[]
): void {
  for (const surface of ownedSurfaces) {
    restoreKeyRefs[surface].current = null;
  }
}

export function shouldRestoreChatScrollSurface(
  restoreKey: string | null,
  restoredKey: string | null
): boolean {
  return Boolean(restoreKey) && restoredKey !== restoreKey;
}

export function getChatSurfaceOwnership(
  surface: WorkspaceSurface | null
): ChatScrollSurface[] {
  return surface ? [surface] : ["desktop", "mobile"];
}

export function ownsChatSurface(
  owner: WorkspaceSurface | null,
  surface: ChatScrollSurface
): boolean {
  return owner === null || owner === surface;
}

export interface ChatPersistenceShell {
  hydrated: boolean;
  authStatus: "unknown" | "guest" | "authenticated";
  isLoggedIn: boolean;
  token: string | null;
  user: { id: string } | null;
}

export function resolveChatPersistenceIdentity(
  shell: ChatPersistenceShell
): string | null {
  if (!shell.hydrated) {
    return null;
  }

  if (shell.authStatus === "authenticated" || shell.isLoggedIn || shell.token) {
    const userId = shell.user?.id.trim();
    return userId ? `user:${userId}` : null;
  }

  return "guest";
}

export function shouldClearChatDraftAfterSend({
  currentIdentity,
  loadedDraftIdentity,
  persistenceIdentityAtSend,
  currentDraft,
  draftAtSend
}: {
  currentIdentity: string | null;
  loadedDraftIdentity: string | null | undefined;
  persistenceIdentityAtSend: string | null;
  currentDraft: string;
  draftAtSend: string;
}): boolean {
  return (
    currentIdentity === persistenceIdentityAtSend &&
    loadedDraftIdentity === persistenceIdentityAtSend &&
    currentDraft === draftAtSend
  );
}

export function getChatDraftStorageKey(identity: string | null): string | null {
  return identity ? `${chatDraftStoragePrefix}:${encodeURIComponent(identity)}` : null;
}

export function getChatScrollStorageKey(
  identity: string | null,
  sessionId: string | null,
  surface: ChatScrollSurface
): string | null {
  if (!identity || !sessionId) {
    return null;
  }

  return `${chatScrollStoragePrefix}:${encodeURIComponent(identity)}:${encodeURIComponent(sessionId)}:${surface}`;
}

export function readChatDraft(identity: string | null): string {
  const key = getChatDraftStorageKey(identity);
  if (!key || typeof window === "undefined") {
    return "";
  }

  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeChatDraft(identity: string | null, value: string): void {
  const key = getChatDraftStorageKey(identity);
  if (!key || typeof window === "undefined") {
    return;
  }

  try {
    if (value.length === 0) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, value);
    }
  } catch {
    // Browser storage can be unavailable without affecting in-memory chat.
  }
}

export function readChatScrollTop(
  identity: string | null,
  sessionId: string | null,
  surface: ChatScrollSurface
): number | null {
  const key = getChatScrollStorageKey(identity, sessionId, surface);
  if (!key || typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) {
      return null;
    }

    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeChatScrollTop(
  identity: string | null,
  sessionId: string | null,
  surface: ChatScrollSurface,
  top: number
): void {
  const key = getChatScrollStorageKey(identity, sessionId, surface);
  if (!key || typeof window === "undefined" || !Number.isFinite(top) || top < 0) {
    return;
  }

  try {
    window.sessionStorage.setItem(key, String(top));
  } catch {
    // Browser storage can be unavailable without affecting scroll behavior.
  }
}

export interface ChatScrollRestorePlan {
  top: number;
  behavior: "auto";
  shouldFollowBottom: boolean;
}

export interface ChatSessionScrollState {
  activeSessionId: string | null;
  loadedMessagesSessionId: string | null;
  hasMessages: boolean;
}

export function createChatSessionScrollState(
  activeSessionId: string | null
): ChatSessionScrollState {
  return {
    activeSessionId,
    loadedMessagesSessionId: null,
    hasMessages: false
  };
}

export function canRestoreChatScrollForSession({
  activeSessionId,
  loadedMessagesSessionId,
  hasMessages
}: ChatSessionScrollState): boolean {
  return Boolean(
    activeSessionId &&
      activeSessionId === loadedMessagesSessionId &&
      hasMessages
  );
}

export function consumeChatScrollRestoreFollowSuppression(
  suppressionRef: { current: boolean }
): boolean {
  if (!suppressionRef.current) {
    return false;
  }

  suppressionRef.current = false;
  return true;
}

export function getChatScrollRestorePlan({
  hasMessages,
  savedTop,
  scrollHeight,
  clientHeight
}: {
  hasMessages: boolean;
  savedTop: number | null;
  scrollHeight: number;
  clientHeight: number;
}): ChatScrollRestorePlan | null {
  if (!hasMessages) {
    return null;
  }

  const maxTop = Math.max(0, scrollHeight - clientHeight);
  const top = savedTop === null
    ? maxTop
    : Math.min(Math.max(0, savedTop), maxTop);

  return {
    top,
    behavior: "auto",
    shouldFollowBottom: savedTop === null || isNearBottom({
      scrollHeight,
      scrollTop: top,
      clientHeight
    })
  };
}

export function shouldAutoFollowChat(
  hasMessages: boolean,
  shouldFollowBottom: boolean
): boolean {
  return hasMessages && shouldFollowBottom;
}

interface QuotaResponse {
  remainingCredits: number;
}

export function getChatTurnAnchorId(
  mode: "desktop" | "mobile",
  messageId: string
): string {
  return `chat-turn-${mode}-${messageId}`;
}

function resolveInitialModel(
  enabledModels: AiModelSummary[],
  configuredDefault: string | undefined,
  handoffModelId?: string | null
) {
  const chatModels = enabledModels.filter(
    (m) =>
      isChatCapableModel(m) &&
      normalizeModelDisplaySurfaces(m.displaySurfaces, m.capability).includes(
        "chat"
      )
  );
  const configured = configuredDefault?.trim();

  if (handoffModelId && chatModels.some((model) => model.modelId === handoffModelId)) {
    return handoffModelId;
  }

  if (
    configured &&
    chatModels.some((model) => model.modelId === configured)
  ) {
    return configured;
  }

  return chatModels[0]?.modelId ?? fallbackModel;
}

function readChatModelHandoff(): string | null {
  try {
    const raw = window.sessionStorage.getItem(chatModelHandoffStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { modelId?: unknown; createdAt?: unknown };
    const now = Date.now();
    if (
      typeof parsed.modelId !== "string" ||
      parsed.modelId.trim().length === 0 ||
      typeof parsed.createdAt !== "number" ||
      !Number.isFinite(parsed.createdAt) ||
      now - parsed.createdAt > chatModelHandoffMaxAgeMs ||
      parsed.createdAt - now > chatModelHandoffMaxAgeMs
    ) {
      window.sessionStorage.removeItem(chatModelHandoffStorageKey);
      return null;
    }
    return parsed.modelId.trim();
  } catch {
    return null;
  }
}

function clearChatModelHandoff() {
  try {
    window.sessionStorage.removeItem(chatModelHandoffStorageKey);
  } catch {
    // Browser storage can be unavailable without affecting chat selection.
  }
}

export const modelLibraryPageSize = 9;

type ModelLibraryAction = "chat" | "image" | "unavailable";

export function getModelLibraryAction(model: AiModelSummary): ModelLibraryAction {
  const displaySurfaces = normalizeModelDisplaySurfaces(
    model.displaySurfaces,
    model.capability
  );

  if (model.capability === "chat" && displaySurfaces.includes("chat")) {
    return "chat";
  }

  if (model.capability === "image" && displaySurfaces.includes("image")) {
    return "image";
  }

  return "unavailable";
}

export function getModelLibraryActionLabel(
  action: ModelLibraryAction,
  locale: string
): string {
  const isZh = locale === "zh-CN";

  if (action === "chat") {
    return isZh ? "去对话" : "Go to chat";
  }

  if (action === "image") {
    return isZh ? "去图像创作" : "Go to Image Creation";
  }

  return isZh ? "即将上线" : "Coming soon";
}

function getModelLibraryPaginationText(
  key: "previous" | "next" | "page" | "total",
  locale: string,
  values: { currentPage?: number; totalPages?: number; totalModels?: number } = {}
): string {
  const isZh = locale === "zh-CN";

  if (key === "previous") {
    return isZh ? "上一页" : "Previous";
  }

  if (key === "next") {
    return isZh ? "下一页" : "Next";
  }

  if (key === "page") {
    return isZh
      ? `第 ${values.currentPage} / ${values.totalPages} 页`
      : `Page ${values.currentPage} / ${values.totalPages}`;
  }

  return isZh ? `共 ${values.totalModels} 个模型` : `${values.totalModels} models`;
}

export function getModelLibraryTotalPages(
  totalModels: number,
  pageSize = modelLibraryPageSize
): number {
  return Math.max(1, Math.ceil(totalModels / pageSize));
}

export function clampModelLibraryPage(
  page: number,
  totalModels: number,
  pageSize = modelLibraryPageSize
): number {
  const totalPages = getModelLibraryTotalPages(totalModels, pageSize);

  if (!Number.isFinite(page)) {
    return 1;
  }

  return Math.min(Math.max(Math.trunc(page), 1), totalPages);
}

export function paginateModelLibraryModels<T>(
  models: T[],
  currentPage: number,
  pageSize = modelLibraryPageSize
): T[] {
  const safePage = clampModelLibraryPage(currentPage, models.length, pageSize);
  const start = (safePage - 1) * pageSize;

  return models.slice(start, start + pageSize);
}

export function filterModelLibraryModels(
  models: AiModelSummary[],
  filters: {
    searchQuery?: string;
    capabilityFilter?: string;
    providerFilter?: string;
    billingFilter?: string;
  }
): AiModelSummary[] {
  const query = filters.searchQuery?.trim().toLowerCase() ?? "";
  const capabilityFilter = filters.capabilityFilter ?? "all";
  const providerFilter = filters.providerFilter ?? "all";
  const billingFilter = filters.billingFilter ?? "all";

  return models.filter((model) => {
    const capabilityMatches =
      capabilityFilter === "all" || model.capability === capabilityFilter;
    const providerMatches =
      providerFilter === "all" || model.provider === providerFilter;
    const billingMatches =
      billingFilter === "all" ||
      (billingFilter === "free" && model.creditCost <= 0) ||
      (billingFilter === "paid" && model.creditCost > 0);
    const searchMatches =
      query.length === 0 ||
      [
        model.name,
        model.displayName ?? "",
        model.shortDescription ?? "",
        ...model.tags,
      ].some((value) => value.toLowerCase().includes(query));

    return capabilityMatches && providerMatches && billingMatches && searchMatches;
  });
}

export function createFeaturedChatModels(
  models: AiModelSummary[],
  selectedModel: string
) {
  const chatModels = models.filter(
    (model) =>
      isChatCapableModel(model) &&
      normalizeModelDisplaySurfaces(
        model.displaySurfaces,
        model.capability
      ).includes("chat") &&
      model.enabled !== false
  );
  const candidates = chatModels.slice(0, 6);
  const selected = chatModels.find((model) => model.modelId === selectedModel);
  const list =
    selected && !candidates.some((model) => model.modelId === selected.modelId)
      ? [...candidates.slice(0, 5), selected]
      : candidates;

  return list.map((model) => ({
    model,
    isCurrent: model.modelId === selectedModel
  }));
}

function ModelLibraryPanelShell({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex h-[100dvh] min-w-0 flex-col overflow-hidden bg-white dark:bg-slate-950">
      <div className="shrink-0 border-b border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur sm:px-6 sm:py-3 dark:border-slate-700 dark:bg-slate-900/95">
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

export function ModelsPanel({
  models,
  modelsLoaded,
  selectedModel,
  onSelectModel,
  onOpenImageModel
}: {
  models: AiModelSummary[];
  modelsLoaded: boolean;
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  onOpenImageModel: (modelId: string) => void;
}) {
  const { locale, t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [capabilityFilter, setCapabilityFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [billingFilter, setBillingFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const providers = useMemo(
    () => Array.from(new Set(models.map((model) => model.provider).filter(Boolean))).sort(),
    [models]
  );
  const filteredModels = useMemo(() => {
    return filterModelLibraryModels(models, {
      searchQuery,
      capabilityFilter,
      providerFilter,
      billingFilter
    });
  }, [billingFilter, capabilityFilter, models, providerFilter, searchQuery]);
  const totalPages = getModelLibraryTotalPages(filteredModels.length);
  const currentModels = useMemo(
    () => paginateModelLibraryModels(filteredModels, currentPage),
    [currentPage, filteredModels]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [billingFilter, capabilityFilter, providerFilter, searchQuery]);

  useEffect(() => {
    const safePage = clampModelLibraryPage(currentPage, filteredModels.length);

    if (safePage !== currentPage) {
      setCurrentPage(safePage);
    }
  }, [currentPage, filteredModels.length]);

  function getFriendlyProviderLabel(provider: string): string {
    const key = provider.toLowerCase();
    if (key.includes("sub2api") || key.includes("openrouter")) return "通用";
    if (key.includes("agnes") || key.includes("image")) return "图像服务";
    if (key.includes("deepseek")) return "DeepSeek";
    if (key.includes("openai")) return "OpenAI";
    if (key.includes("qwen") || key.includes("alibaba")) return "阿里云";
    return provider;
  }

  if (!modelsLoaded) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-indigo-400 dark:ring-slate-700">
            <Globe className="size-6 animate-pulse" aria-hidden="true" />
          </span>
          <h3 className="mt-5 text-xl font-semibold text-slate-950 dark:text-slate-100">
            {t("chat.loadingModels")}
          </h3>
        </div>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-indigo-400 dark:ring-slate-700">
            <Globe className="size-6" aria-hidden="true" />
          </span>
          <h3 className="mt-5 text-xl font-semibold text-slate-950 dark:text-slate-100">
            {t("chat.noModelsAvailable")}
          </h3>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto mb-5 grid max-w-5xl gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-4">
        <label className="grid min-w-0 gap-2">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {t("models.searchLabel")}
          </span>
          <span className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 focus-within:border-indigo-300 focus-within:bg-white dark:border-slate-700 dark:bg-slate-800 dark:focus-within:border-indigo-500 dark:focus-within:bg-slate-800">
            <Search className="size-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
            <input
              className="h-11 w-full min-w-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("models.searchPlaceholder")}
            />
          </span>
        </label>
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 md:hidden" data-model-library-mobile-capability-chips="true">
          {(["all", "chat", "image", "video", "ppt"] as const).map((capability) => (
            <button
              key={capability}
              type="button"
              className={capabilityFilter === capability ? "min-h-9 shrink-0 rounded-full bg-indigo-600 px-3 text-xs font-semibold text-white" : "min-h-9 shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"}
              onClick={() => setCapabilityFilter(capability)}
              aria-pressed={capabilityFilter === capability}
              data-model-library-capability-chip={capability}
            >
              {t(`models.capability.${capability}`)}
            </button>
          ))}
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3">
          <label className="hidden min-w-0 gap-2 md:grid">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {t("models.capabilityFilter")}
            </span>
            <select
              className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-indigo-500 dark:focus:bg-slate-800"
              value={capabilityFilter}
              onChange={(event) => setCapabilityFilter(event.target.value)}
            >
              <option value="all">{t("models.capability.all")}</option>
              <option value="chat">{t("models.capability.chat")}</option>
              <option value="image">{t("models.capability.image")}</option>
              <option value="video">{t("models.capability.video")}</option>
              <option value="ppt">{t("models.capability.ppt")}</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 md:gap-2">
            <span className="sr-only text-sm font-semibold text-slate-800 md:not-sr-only dark:text-slate-200">
              {t("models.providerFilter")}
            </span>
            <select
              className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:bg-white md:h-11 md:px-3 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-indigo-500 dark:focus:bg-slate-800"
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
            >
              <option value="all">{t("models.provider.all")}</option>
              {providers.map((provider) => (
                <option key={provider} value={provider}>
                  {getFriendlyProviderLabel(provider)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 md:gap-2">
            <span className="sr-only text-sm font-semibold text-slate-800 md:not-sr-only dark:text-slate-200">
              {t("models.billingFilter")}
            </span>
            <select
              className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:bg-white md:h-11 md:px-3 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-indigo-500 dark:focus:bg-slate-800"
              value={billingFilter}
              onChange={(event) => setBillingFilter(event.target.value)}
            >
              <option value="all">{t("models.billing.all")}</option>
              <option value="free">{t("models.billing.free")}</option>
              <option value="paid">{t("models.billing.paid")}</option>
            </select>
          </label>
        </div>
      </div>
      <div
        className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3"
        role="listbox"
        aria-label={t("chat.selectModel")}
      >
        {currentModels.map((model) => {
          const action = getModelLibraryAction(model);
          const isUnavailable = action === "unavailable";
          const actionLabel = getModelLibraryActionLabel(action, locale);

          function handleModelAction() {
            if (action === "chat") {
              onSelectModel(model.modelId);
              return;
            }

            if (action === "image") {
              onOpenImageModel(model.slug);
            }
          }

          return (
            <article
              key={model.modelId}
              role="option"
              aria-selected={false}
              className={
                isUnavailable
                  ? "grid min-w-0 cursor-not-allowed gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left opacity-75 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                  : "grid min-w-0 gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800"
              }
              data-model-library-card={model.modelId}
              data-model-library-action={action}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <ModelIcon
                    model={model}
                    selected={false}
                    className="size-10 shrink-0 rounded-2xl"
                    imageClassName="size-5"
                  />
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-semibold text-slate-950 dark:text-slate-100">
                      {model.displayName || model.name}
                    </h3>
                    {model.shortDescription ? (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        {model.shortDescription}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone={model.capability === "image" ? "amber" : "indigo"}>
                  {t(`models.capability.${model.capability}`)}
                </Badge>
                <Badge tone={model.creditCost <= 0 ? "emerald" : "slate"}>
                  {formatModelCreditCostLabel(model.creditCost, locale)}
                </Badge>
                <Badge tone="slate">
                  {formatModelAccessLabel(model.allowGuest, false, locale)}
                </Badge>
                {model.isRecommended ? (
                  <Badge tone="indigo">{t("chat.recommended")}</Badge>
                ) : null}
              </div>
              <div className="pt-1">
                <button
                  type="button"
                  disabled={isUnavailable}
                  onClick={handleModelAction}
                  className="inline-flex rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-indigo-300"
                >
                  {actionLabel}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {totalPages > 1 ? (
          <div
            className="mx-auto mt-5 flex max-w-5xl flex-wrap items-center justify-center gap-3 text-sm text-slate-600 dark:text-slate-400"
            data-model-library-pagination="true"
          >
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 disabled:cursor-not-allowed disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-indigo-400 dark:disabled:text-slate-600"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((page) => clampModelLibraryPage(page - 1, filteredModels.length))}
            data-model-library-pagination-prev="true"
          >
            {getModelLibraryPaginationText("previous", locale)}
          </button>
          <span
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            data-model-library-pagination-page={`${currentPage}/${totalPages}`}
          >
            {getModelLibraryPaginationText("page", locale, {
              currentPage,
              totalPages
            })}
          </span>
          <span
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
            data-model-library-pagination-total={filteredModels.length}
          >
            {getModelLibraryPaginationText("total", locale, {
              totalModels: filteredModels.length
            })}
          </span>
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 disabled:cursor-not-allowed disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-indigo-400 dark:disabled:text-slate-600"
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((page) => clampModelLibraryPage(page + 1, filteredModels.length))}
            data-model-library-pagination-next="true"
          >
            {getModelLibraryPaginationText("next", locale)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ChatWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, t } = useI18n();
  const workspaceShell = useWorkspaceShellContext();
  const {
    shell,
    logout: workspaceLogout,
    setCreateSession: setWorkspaceCreateSession,
    setCurrentModelLabel: setWorkspaceCurrentModelLabel,
    setCurrentTitle: setWorkspaceCurrentTitle,
    setSidebar: setWorkspaceSidebar,
    setAuthUser,
    refreshQuota: ctxRefreshQuota
  } = workspaceShell;
  const publicSettings = usePublicSettings();
  const persistenceIdentity = resolveChatPersistenceIdentity(shell);
  const workspaceSurface = useOptionalWorkspaceSurface();
  const ownedChatSurfaces = useMemo(
    () => getChatSurfaceOwnership(workspaceSurface),
    [workspaceSurface]
  );
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const mobileMessageViewportRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowDesktopBottomRef = useRef(true);
  const shouldFollowMobileBottomRef = useRef(true);
  const suppressDesktopAutoFollowAfterRestoreRef = useRef(false);
  const suppressMobileAutoFollowAfterRestoreRef = useRef(false);
  const restoredDesktopScrollKeyRef = useRef<string | null>(null);
  const restoredMobileScrollKeyRef = useRef<string | null>(null);
  const lastDesktopScrollTopRef = useRef(0);
  const lastMobileScrollTopRef = useRef(0);
  const hasDesktopScrollPositionRef = useRef(false);
  const hasMobileScrollPositionRef = useRef(false);
  const scrollRuntimeOwnerRef = useRef<Pick<ChatScrollRuntimeState, "identity" | "sessionId">>({
    identity: persistenceIdentity,
    sessionId: null
  });
  const persistenceIdentityRef = useRef<string | null>(persistenceIdentity);
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionTransitionVersionRef = useRef(0);
  const draftLoadedIdentityRef = useRef<string | null | undefined>(undefined);
  const draftValueRef = useRef("");
  const sendingRef = useRef(false);
  const creatingSessionRef = useRef(false);
  const pendingCreateAfterDiscardRef = useRef(false);
  const titleUpdateInFlightRef = useRef(false);
  const updatedSessionTitleIdsRef = useRef(new Set<string>());
  const desktopTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mobileTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [loadedMessagesSessionId, setLoadedMessagesSessionId] = useState<string | null>(null);
  const [models, setModels] = useState<AiModelSummary[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [selectedModel, setSelectedModel] = useState(fallbackModel);
  const modelSelectionLockedRef = useRef(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDesktopAwayFromBottom, setIsDesktopAwayFromBottom] = useState(false);
  const [isMobileAwayFromBottom, setIsMobileAwayFromBottom] = useState(false);
  const [isDiscardDraftOpen, setIsDiscardDraftOpen] = useState(false);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const token = shell.token;
  const requestedSessionId = searchParams.get("sessionId");
  const isLoggedIn = shell.isLoggedIn;
  const isAdmin = shell.isAdmin;
  const user = shell.user;
  const activeSessionId = currentSessionId;
  persistenceIdentityRef.current = persistenceIdentity;
  activeSessionIdRef.current = activeSessionId;
  const selectedModelInfo =
    models.find((model) => model.modelId === selectedModel) ?? null;

  /** Featured chat models for the secondary sidebar (chat-only, no image/video/ppt). */
  const featuredModels = useMemo(
    () => createFeaturedChatModels(models, selectedModel),
    [models, selectedModel]
  );
  const selectedModelDisplayName = resolveSelectedModelDisplayLabel({
    models,
    selectedModel,
    modelsLoaded
  });
  const fallbackPromptSuggestions = useMemo<PromptSuggestion[]>(
    () => [
      {
        title: t("chat.prompt.idea.title"),
        description: t("chat.prompt.idea.body"),
        prompt: t("chat.prompt.idea.body")
      },
      {
        title: t("chat.prompt.write.title"),
        description: t("chat.prompt.write.body"),
        prompt: t("chat.prompt.write.body")
      },
      {
        title: t("chat.prompt.imagePrompt.title"),
        description: t("chat.prompt.imagePrompt.body"),
        prompt: t("chat.prompt.imagePrompt.body")
      },
      {
        title: t("chat.prompt.openImage.title"),
        description: t("chat.prompt.openImage.body"),
        prompt: t("chat.prompt.openImage.body")
      }
    ],
    [t]
  );
  const promptSuggestions = useMemo<PromptSuggestion[]>(
    () =>
      parseWorkspacePromptCards(
        publicSettings?.workspacePromptCards,
        fallbackPromptSuggestions
      ),
    [fallbackPromptSuggestions, publicSettings?.workspacePromptCards]
  );
  const workspaceHero = resolveWorkspaceHero(publicSettings, {
    title: t("chat.emptyHeadline"),
    subtitle: isLoggedIn
      ? t("chat.loggedInStartHint")
      : t("chat.anonymousRefreshHint")
  });
  const workspaceHint = publicSettings?.workspaceHint?.trim();
  const workspacePromptPlaceholder =
    publicSettings?.workspacePromptPlaceholder?.trim() ||
    t("chat.inputPlaceholder");
  const guestModeDisabled =
    !isLoggedIn && publicSettings?.guestModeEnabled === false;
  const canSendMessage =
    !guestModeDisabled &&
    canSendChatMessage({
    input,
    isSending: isLoading,
    selectedModel
    });

  const authHeaders = useMemo<Record<string, string>>(() => {
    if (!token) {
      return {} as Record<string, string>;
    }

    return {
      Authorization: `Bearer ${token}`
    };
  }, [token]);



  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    console.log("[chat debug]", {
      apiBaseUrl: siteConfig.apiBaseUrl,
      selectedModel,
      inputLength: input.trim().length,
      isSending: isLoading,
      isLoggedIn,
      activeSessionId
    });
  }, [activeSessionId, input, isLoading, isLoggedIn, selectedModel]);

  useLayoutEffect(() => {
    const restoredIdentity = persistenceIdentity;
    draftLoadedIdentityRef.current = restoredIdentity ?? null;
    const restoredDraft = readChatDraft(restoredIdentity);
    draftValueRef.current = restoredDraft;
    setInput(restoredDraft);
  }, [persistenceIdentity]);

  const setInputDraft = useCallback(
    (value: string) => {
      draftValueRef.current = value;
      setInput(value);
      if (draftLoadedIdentityRef.current === persistenceIdentity) {
        writeChatDraft(persistenceIdentity, value);
      }
    },
    [persistenceIdentity]
  );

  const clearInputDraft = useCallback(
    (expectedValue?: string, expectedIdentity?: string | null) => {
      const currentIdentity = persistenceIdentityRef.current;
      if (
        expectedIdentity !== undefined &&
        (expectedValue === undefined ||
          !shouldClearChatDraftAfterSend({
            currentIdentity,
            loadedDraftIdentity: draftLoadedIdentityRef.current,
            persistenceIdentityAtSend: expectedIdentity,
            currentDraft: draftValueRef.current,
            draftAtSend: expectedValue
          }))
      ) {
        return;
      }
      if (expectedValue !== undefined && draftValueRef.current !== expectedValue) {
        return;
      }

      draftValueRef.current = "";
      setInput("");
      if (draftLoadedIdentityRef.current === currentIdentity) {
        writeChatDraft(currentIdentity, "");
      }
    },
    [persistenceIdentity]
  );

  const hasMessages = messages.length > 0;

  const persistChatScrollRuntime = useCallback(
    (targetOwner: Pick<ChatScrollRuntimeState, "identity" | "sessionId">) => {
      const runtimeOwner = scrollRuntimeOwnerRef.current;
      if (
        runtimeOwner.identity !== targetOwner.identity ||
        runtimeOwner.sessionId !== targetOwner.sessionId
      ) {
        return;
      }

      const runtime: ChatScrollRuntimeState = {
        ...createChatScrollRuntimeState(
          runtimeOwner.identity,
          runtimeOwner.sessionId
        ),
        shouldFollowDesktopBottom: shouldFollowDesktopBottomRef.current,
        shouldFollowMobileBottom: shouldFollowMobileBottomRef.current,
        lastDesktopScrollTop: lastDesktopScrollTopRef.current,
        lastMobileScrollTop: lastMobileScrollTopRef.current,
        hasDesktopScrollPosition: hasDesktopScrollPositionRef.current,
        hasMobileScrollPosition: hasMobileScrollPositionRef.current
      };

      for (const surface of ownedChatSurfaces) {
        if (!canPersistChatScrollRuntime(
          runtime,
          targetOwner.identity,
          targetOwner.sessionId,
          surface
        )) {
          continue;
        }

        writeChatScrollTop(
          targetOwner.identity,
          targetOwner.sessionId,
          surface,
          surface === "mobile"
            ? runtime.lastMobileScrollTop
            : runtime.lastDesktopScrollTop
        );
      }
    },
    [ownedChatSurfaces]
  );

  const transitionChatScrollRuntime = useCallback(
    (nextSessionId: string | null) => {
      persistChatScrollRuntime({
        identity: persistenceIdentityRef.current,
        sessionId: activeSessionIdRef.current
      });
      resetChatScrollRestoreOwnership(
        {
          desktop: restoredDesktopScrollKeyRef,
          mobile: restoredMobileScrollKeyRef
        },
        ownedChatSurfaces
      );

      const nextRuntime = createChatScrollRuntimeState(
        persistenceIdentityRef.current,
        nextSessionId
      );
      scrollRuntimeOwnerRef.current = {
        identity: nextRuntime.identity,
        sessionId: nextRuntime.sessionId
      };
      shouldFollowDesktopBottomRef.current = nextRuntime.shouldFollowDesktopBottom;
      shouldFollowMobileBottomRef.current = nextRuntime.shouldFollowMobileBottom;
      suppressDesktopAutoFollowAfterRestoreRef.current = false;
      suppressMobileAutoFollowAfterRestoreRef.current = false;
      lastDesktopScrollTopRef.current = nextRuntime.lastDesktopScrollTop;
      lastMobileScrollTopRef.current = nextRuntime.lastMobileScrollTop;
      hasDesktopScrollPositionRef.current = nextRuntime.hasDesktopScrollPosition;
      hasMobileScrollPositionRef.current = nextRuntime.hasMobileScrollPosition;
    },
    [ownedChatSurfaces, persistChatScrollRuntime]
  );

  const resetChatSessionState = useCallback((nextSessionId: string | null) => {
    sessionTransitionVersionRef.current += 1;
    transitionChatScrollRuntime(nextSessionId);
    activeSessionIdRef.current = nextSessionId;
    setMessages([]);
    setLoadedMessagesSessionId(null);
    setCurrentSessionId(nextSessionId);
    return sessionTransitionVersionRef.current;
  }, [transitionChatScrollRuntime]);

  useLayoutEffect(() => {
    if (ownsChatPersistenceIdentity(
      scrollRuntimeOwnerRef.current.identity,
      persistenceIdentity
    )) {
      return;
    }

    persistChatScrollRuntime(scrollRuntimeOwnerRef.current);
    resetChatSessionState(null);
  }, [persistenceIdentity, persistChatScrollRuntime, resetChatSessionState]);

  useLayoutEffect(() => {
    const ownsCurrentScrollRuntime =
      ownsChatPersistenceIdentity(
        scrollRuntimeOwnerRef.current.identity,
        persistenceIdentity
      ) && scrollRuntimeOwnerRef.current.sessionId === activeSessionId;
    const canRestore = canRestoreChatScrollForSession({
      activeSessionId,
      loadedMessagesSessionId,
      hasMessages
    });
    const restoreKey =
      ownsCurrentScrollRuntime && persistenceIdentity && canRestore
        ? `${persistenceIdentity}:${activeSessionId}:${hasMessages ? "messages" : "empty"}`
        : null;

    if (!restoreKey) {
      setIsMobileAwayFromBottom(false);
      setIsDesktopAwayFromBottom(false);
      return;
    }

    const surfaces: Array<{
      surface: ChatScrollSurface;
      container: HTMLDivElement | null;
      restoredKeyRef: React.MutableRefObject<string | null>;
      followRef: React.MutableRefObject<boolean>;
      suppressAutoFollowRef: React.MutableRefObject<boolean>;
      setAway: (away: boolean) => void;
      setLastTop: (top: number) => void;
    }> = ownedChatSurfaces.map((surface) =>
      surface === "desktop"
        ? {
            surface,
            container: messageViewportRef.current,
            restoredKeyRef: restoredDesktopScrollKeyRef,
            followRef: shouldFollowDesktopBottomRef,
            suppressAutoFollowRef: suppressDesktopAutoFollowAfterRestoreRef,
            setAway: setIsDesktopAwayFromBottom,
            setLastTop: (top: number) => { lastDesktopScrollTopRef.current = top; }
          }
        : {
            surface,
            container: mobileMessageViewportRef.current,
            restoredKeyRef: restoredMobileScrollKeyRef,
            followRef: shouldFollowMobileBottomRef,
            suppressAutoFollowRef: suppressMobileAutoFollowAfterRestoreRef,
            setAway: setIsMobileAwayFromBottom,
            setLastTop: (top: number) => { lastMobileScrollTopRef.current = top; }
          }
    );

    for (const item of surfaces) {
      if (!item.container || !shouldRestoreChatScrollSurface(restoreKey, item.restoredKeyRef.current)) {
        continue;
      }

      const plan = getChatScrollRestorePlan({
        hasMessages,
        savedTop: readChatScrollTop(
          persistenceIdentity,
          activeSessionId,
          item.surface
        ),
        scrollHeight: item.container.scrollHeight,
        clientHeight: item.container.clientHeight
      });

      if (!plan) {
        continue;
      }

      item.container.scrollTo({ top: plan.top, behavior: plan.behavior });
      item.setLastTop(plan.top);
      if (item.surface === "mobile") {
        hasMobileScrollPositionRef.current = true;
      } else {
        hasDesktopScrollPositionRef.current = true;
      }
      item.followRef.current = plan.shouldFollowBottom;
      item.suppressAutoFollowRef.current = true;
      item.setAway(!plan.shouldFollowBottom);
      item.restoredKeyRef.current = restoreKey;
    }
  }, [activeSessionId, hasMessages, loadedMessagesSessionId, ownedChatSurfaces, persistenceIdentity]);

  useEffect(() => {
    const effectOwner = {
      identity: persistenceIdentity,
      sessionId: activeSessionId
    };

    return () => {
      persistChatScrollRuntime(effectOwner);
    };
  }, [activeSessionId, persistChatScrollRuntime, persistenceIdentity]);

  useLayoutEffect(() => {
    const ownsCurrentScrollRuntime =
      ownsChatPersistenceIdentity(
        scrollRuntimeOwnerRef.current.identity,
        persistenceIdentity
      ) && scrollRuntimeOwnerRef.current.sessionId === activeSessionId;
    if (!ownsCurrentScrollRuntime) {
      return;
    }
    if (consumeChatScrollRestoreFollowSuppression(suppressDesktopAutoFollowAfterRestoreRef)) {
      return;
    }
    if (!ownsChatSurface(workspaceSurface, "desktop")) {
      return;
    }
    if (!shouldAutoFollowChat(hasMessages, shouldFollowDesktopBottomRef.current)) {
      return;
    }

    const container = messageViewportRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
      lastDesktopScrollTopRef.current = container.scrollHeight;
      hasDesktopScrollPositionRef.current = true;
    }
  }, [activeSessionId, error, hasMessages, isLoading, messages, persistenceIdentity, workspaceSurface]);

  useLayoutEffect(() => {
    const ownsCurrentScrollRuntime =
      ownsChatPersistenceIdentity(
        scrollRuntimeOwnerRef.current.identity,
        persistenceIdentity
      ) && scrollRuntimeOwnerRef.current.sessionId === activeSessionId;
    if (!ownsCurrentScrollRuntime) {
      return;
    }
    if (consumeChatScrollRestoreFollowSuppression(suppressMobileAutoFollowAfterRestoreRef)) {
      return;
    }
    if (!ownsChatSurface(workspaceSurface, "mobile")) {
      return;
    }
    if (!shouldAutoFollowChat(hasMessages, shouldFollowMobileBottomRef.current)) {
      return;
    }

    const container = mobileMessageViewportRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
      lastMobileScrollTopRef.current = container.scrollHeight;
      hasMobileScrollPositionRef.current = true;
    }
  }, [activeSessionId, error, hasMessages, isLoading, messages, persistenceIdentity, workspaceSurface]);

  useEffect(() => {
    for (const textarea of [desktopTextareaRef.current, mobileTextareaRef.current]) {
      if (!textarea) {
        continue;
      }

      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }
  }, [input]);

  const requestJson = useCallback(async <T,>(
    url: string,
    init?: RequestInit,
    options: { networkErrorMessage?: string } = {}
  ): Promise<T> => {
    let response: Response;

    try {
      response = await fetch(url, init);
    } catch (fetchError) {
      const message =
        fetchError instanceof Error && fetchError.message !== "Failed to fetch"
          ? fetchError.message
          : options.networkErrorMessage ?? `${t("chat.apiUnreachable")} (${siteConfig.apiBaseUrl})`;
      throw new Error(message);
    }

    if (response.status === 401) {
      workspaceLogout();
      setSessions([]);
      resetChatSessionState(null);
      throw new Error(t("chat.loginRequired"));
    }

    if (!response.ok) {
      throw new Error(await readResponseErrorMessage(response, t("chat.requestFailed")));
    }

    const text = await response.text();

    if (!text.trim()) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }, [resetChatSessionState, t, workspaceLogout]);

  const loadSessions = useCallback(async () => {
    const data = await requestJson<{ sessions: ChatSessionSummary[] }>(
      apiUrl("/chat/sessions"),
      {
        headers: authHeaders
      }
    );
    setSessions(data.sessions);
    return data.sessions;
  }, [authHeaders, requestJson]);


  const loadMessages = useCallback(async (
    sessionId: string,
    headers: Record<string, string> = authHeaders,
    transitionVersion = sessionTransitionVersionRef.current,
    signal?: AbortSignal
  ): Promise<boolean> => {
    const data = await requestJson<{ messages: ChatMessageRecord[] }>(
      apiUrl(`/chat/sessions/${sessionId}/messages`),
      {
        headers,
        signal
      }
    );

    if (
      transitionVersion !== sessionTransitionVersionRef.current ||
      activeSessionIdRef.current !== sessionId
    ) {
      return false;
    }

    setLoadedMessagesSessionId(sessionId);
    setMessages(data.messages);
    return true;
  }, [authHeaders, requestJson]);

  const latestChatBootstrapLoadMessagesRef = useRef(loadMessages);
  latestChatBootstrapLoadMessagesRef.current = loadMessages;
  const latestChatBootstrapActionsRef = useRef({
    ctxRefreshQuota,
    resetChatSessionState,
    setAuthUser,
    workspaceLogout
  });
  latestChatBootstrapActionsRef.current = {
    ctxRefreshQuota,
    resetChatSessionState,
    setAuthUser,
    workspaceLogout
  };
  const latestChatBootstrapTranslatorRef = useRef(t);
  latestChatBootstrapTranslatorRef.current = t;

  const createSession = useCallback(async () => {
    if (creatingSessionRef.current) {
      return;
    }

    if (sendingRef.current || isLoading) {
      return;
    }

    const isCurrentSessionEmpty = messages.length === 0;
    const hasDraft = input.trim().length > 0;

    if (isCurrentSessionEmpty && !hasDraft) {
      setError(null);
      resetChatSessionState(null);
      desktopTextareaRef.current?.focus();
      return;
    }

    if (hasDraft) {
      if (isDiscardDraftOpen) {
        return;
      }
      pendingCreateAfterDiscardRef.current = !isCurrentSessionEmpty;
      setIsDiscardDraftOpen(true);
      return;
    }

    creatingSessionRef.current = true;

    try {
      setError(null);

      const data = await requestJson<{ session: ChatSessionSummary }>(
        apiUrl("/chat/sessions"),
        {
          method: "POST",
          headers: authHeaders
        }
      );
      setSessions((current) => [data.session, ...current]);
      resetChatSessionState(data.session.id);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : t("chat.createSessionFailed")
      );
    } finally {
      creatingSessionRef.current = false;
    }
  }, [authHeaders, isLoading, input, isDiscardDraftOpen, messages.length, requestJson, resetChatSessionState, t]);

  function handleDiscardDraftConfirm() {
    setIsDiscardDraftOpen(false);
    setError(null);
    clearInputDraft();

    if (pendingCreateAfterDiscardRef.current) {
      pendingCreateAfterDiscardRef.current = false;
      void createSession();
    } else {
      desktopTextareaRef.current?.focus();
    }
  }

  function handleDiscardDraftCancel() {
    setIsDiscardDraftOpen(false);
  }

  const selectSession = useCallback(async (sessionId: string) => {
    setError(null);
    const transitionVersion = resetChatSessionState(sessionId);

    try {
      await loadMessages(sessionId, authHeaders, transitionVersion);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t("chat.loadHistoryFailed")
      );
    }
  }, [authHeaders, loadMessages, resetChatSessionState, t]);

  const updateSessionTitle = useCallback(
    async (sessionId: string, title: string) => {
      await coordinateSessionTitle({
        sessionId,
        currentTitle: title,
        firstUserContent: title,
        locale,
        getPatchUrl: (id) => apiUrl(`/chat/sessions/${id}`),
        fetchImpl: fetch,
        authHeaders,
        titleInFlightRef: titleUpdateInFlightRef,
        updatedIdsRef: updatedSessionTitleIdsRef,
        onTitleUpdated: (sid, newTitle) => {
          setSessions((current) =>
            current.map((s) =>
              s.id === sid ? { ...s, title: newTitle } : s
            )
          );
        }
      });
    },
    [authHeaders, locale]
  );

  const ensureSessionTitle = useCallback(
    (sessionId: string, firstUserContent: string) => {
      const targetSession = sessions.find((s) => s.id === sessionId);
      if (!targetSession) {
        return;
      }
      void coordinateSessionTitle({
        sessionId,
        currentTitle: targetSession.title,
        firstUserContent,
        locale,
        getPatchUrl: (id) => apiUrl(`/chat/sessions/${id}`),
        fetchImpl: fetch,
        authHeaders,
        titleInFlightRef: titleUpdateInFlightRef,
        updatedIdsRef: updatedSessionTitleIdsRef,
        onTitleUpdated: (sid, newTitle) => {
          setSessions((current) =>
            current.map((s) =>
              s.id === sid ? { ...s, title: newTitle } : s
            )
          );
        }
      });
    },
    [authHeaders, locale, sessions]
  );

  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }
    if (updatedSessionTitleIdsRef.current.has(activeSessionId ?? "")) {
      return;
    }
    const compensation = getSessionTitleCompensation({
      activeSession: sessions.find((s) => s.id === activeSessionId),
      messages
    });
    if (!compensation) {
      return;
    }
    if (!shouldRegenerateTitle(
      sessions.find((s) => s.id === activeSessionId)?.title ?? "",
      locale
    )) {
      return;
    }
    void coordinateSessionTitle({
      sessionId: compensation.sessionId,
      currentTitle: sessions.find((s) => s.id === activeSessionId)?.title ?? "",
      firstUserContent: compensation.firstUserContent,
      locale,
      getPatchUrl: (id) => apiUrl(`/chat/sessions/${id}`),
      fetchImpl: fetch,
      authHeaders,
      titleInFlightRef: titleUpdateInFlightRef,
      updatedIdsRef: updatedSessionTitleIdsRef,
      onTitleUpdated: (sid, newTitle) => {
        setSessions((current) =>
          current.map((s) =>
            s.id === sid ? { ...s, title: newTitle } : s
          )
        );
      }
    });
  }, [activeSessionId, authHeaders, isLoggedIn, locale, messages, sessions]);

  const deleteSession = useCallback(async (sessionId: string) => {
    setError(null);

    try {
      const request = createDeleteSessionRequest({
        sessionId,
        token
      });

      if (!request) {
        setError(t("chat.loginToDelete"));
        return;
      }

      await requestJson<{ ok: boolean }>(request.url, request.init, {
        networkErrorMessage: createDeleteSessionNetworkErrorMessage({
          deleteFailedMessage: t("chat.deleteFailed"),
          apiUnreachableMessage: t("chat.apiUnreachable")
        })
      });

      const nextState = createSessionDeleteState({
        deletedSessionId: sessionId,
        currentSessionId,
        sessions
      });

      setSessions(nextState.sessions);

      if (!nextState.currentSessionId) {
        resetChatSessionState(null);
        return;
      }

      if (nextState.shouldReloadMessages) {
        const transitionVersion = resetChatSessionState(nextState.currentSessionId);
        await loadMessages(
          nextState.currentSessionId,
          authHeaders,
          transitionVersion
        );
      } else {
        setCurrentSessionId(nextState.currentSessionId);
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : t("chat.deleteFailed")
      );
    }
  }, [authHeaders, token, currentSessionId, sessions, loadMessages, requestJson, resetChatSessionState, t]);

  const handleModelChange = useCallback((nextModel: string) => {
    modelSelectionLockedRef.current = true;
    const nextState = createModelChangeState({
      oldModel: selectedModel,
      nextModel,
      isAnonymous: !isLoggedIn,
      messages,
      currentSessionId: activeSessionId,
      error
    });

    setSelectedModel(nextState.selectedModel);

    if (nextState.modelChanged && !isLoggedIn) {
      resetChatSessionState(nextState.currentSessionId);
      setError(nextState.error);
    }

    if (process.env.NODE_ENV === "development") {
      console.log("[chat model change]", {
        oldModel: selectedModel,
        nextModel,
        messagesLength: messages.length,
        anonymousMode: !isLoggedIn
      });
    }
  }, [selectedModel, isLoggedIn, messages, activeSessionId, error, resetChatSessionState]);

  const selectModelAndReturnToChat = useCallback(
    (nextModel: string) => {
      const nextModelInfo = models.find((model) => model.modelId === nextModel);

      if (
        nextModelInfo &&
        (!isChatCapableModel(nextModelInfo) ||
          !normalizeModelDisplaySurfaces(
          nextModelInfo.displaySurfaces,
          nextModelInfo.capability
          ).includes("chat"))
      ) {
        return;
      }

      handleModelChange(nextModel);
      router.push("/", { scroll: false });
      setIsModelSelectorOpen(false);
    },
    [handleModelChange, models, router]
  );

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    async function loadInitialData() {
      const bootstrapActions = latestChatBootstrapActionsRef.current;
      const bootstrapHeaders: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};
      setModelsLoaded(false);
      try {
        if (!token) {
          const modelsResponse = await fetch(apiUrl("/models"), {
            signal: controller.signal
          });

          if (!modelsResponse.ok) {
            throw new Error(
              `${latestChatBootstrapTranslatorRef.current("chat.modelLoadFailed")} (${modelsResponse.status})`
            );
          }

          const modelData = (await modelsResponse.json()) as {
            models?: AiModelSummary[];
          };

          if (!isMounted) {
            return;
          }

          const enabledModels = (modelData.models ?? []).filter(
            (model) => model.enabled
          );
          const handoffModelId = readChatModelHandoff();

          if (enabledModels.length > 0) {
            setModels(enabledModels);
            setSelectedModel((current) => {
              const chatModels = enabledModels.filter(
                (model) =>
                  isChatCapableModel(model) &&
                  normalizeModelDisplaySurfaces(
                    model.displaySurfaces,
                    model.capability
                  ).includes("chat")
              );

              if (
                handoffModelId &&
                chatModels.some((model) => model.modelId === handoffModelId)
              ) {
                modelSelectionLockedRef.current = true;
                return handoffModelId;
              }

              if (
                current &&
                chatModels.some((model) => model.modelId === current)
              ) {
                return current;
              }

              return resolveInitialModel(
                enabledModels,
                undefined,
                handoffModelId
              );
            });
          }

          clearChatModelHandoff();

          setModelsLoaded(true);

          return;
        }

        const [meResponse, modelsResponse, sessionsResponse] =
          await Promise.all([
            fetch(apiUrl("/auth/me"), {
              headers: bootstrapHeaders,
              signal: controller.signal
            }),
            fetch(apiUrl("/models"), { signal: controller.signal }),
            fetch(apiUrl("/chat/sessions"), {
              headers: bootstrapHeaders,
              signal: controller.signal
            })
          ]);

        if (
          meResponse.status === 401 ||
          sessionsResponse.status === 401
        ) {
          bootstrapActions.workspaceLogout();
          setSessions([]);
          bootstrapActions.resetChatSessionState(null);
          return;
        }

        if (!meResponse.ok) {
          throw new Error(
            `${latestChatBootstrapTranslatorRef.current("chat.userLoadFailed")} (${meResponse.status})`
          );
        }

        if (!modelsResponse.ok) {
          throw new Error(
            `${latestChatBootstrapTranslatorRef.current("chat.modelLoadFailed")} (${modelsResponse.status})`
          );
        }

        if (!sessionsResponse.ok) {
          throw new Error(
            `${latestChatBootstrapTranslatorRef.current("chat.sessionLoadFailed")} (${sessionsResponse.status})`
          );
        }

        const me = (await meResponse.json()) as { user: AuthUser };
        const modelData = (await modelsResponse.json()) as {
          models?: AiModelSummary[];
        };
        const sessionData = (await sessionsResponse.json()) as {
          sessions?: ChatSessionSummary[];
        };

        if (!isMounted) {
          return;
        }

        const enabledModels = (modelData.models ?? []).filter(
          (model) => model.enabled
        );
        const handoffModelId = readChatModelHandoff();
        bootstrapActions.setAuthUser(me.user);
        setSessions(sessionData.sessions ?? []);
        bootstrapActions.ctxRefreshQuota();

        if (enabledModels.length > 0) {
          setModels(enabledModels);
          setSelectedModel((current) => {
            const chatModels = enabledModels.filter(
              (model) =>
                isChatCapableModel(model) &&
                normalizeModelDisplaySurfaces(
                  model.displaySurfaces,
                  model.capability
                ).includes("chat")
            );

            if (
              handoffModelId &&
              chatModels.some((model) => model.modelId === handoffModelId)
            ) {
              modelSelectionLockedRef.current = true;
              return handoffModelId;
            }

            if (
              current &&
              chatModels.some((model) => model.modelId === current)
            ) {
              return current;
            }

            return resolveInitialModel(
              enabledModels,
              undefined,
              handoffModelId
            );
          });
        }

        clearChatModelHandoff();

        setModelsLoaded(true);

        const firstSession = requestedSessionId
          ? sessionData.sessions?.find((session) => session.id === requestedSessionId)
          : sessionData.sessions?.[0];

        if (firstSession) {
          const transitionVersion = bootstrapActions.resetChatSessionState(
            firstSession.id
          );
          await latestChatBootstrapLoadMessagesRef.current(
            firstSession.id,
            bootstrapHeaders,
            transitionVersion,
            controller.signal
          );
        }
      } catch (loadError) {
        if (isMounted && !controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : latestChatBootstrapTranslatorRef.current("chat.initFailed")
          );
          setModelsLoaded(true);
        }
      }
    }

    void loadInitialData();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [requestedSessionId, token]);

  useEffect(() => {
    if (!modelsLoaded || modelSelectionLockedRef.current) {
      return;
    }

    const configuredDefault = publicSettings?.defaultModel?.trim();
    if (!configuredDefault) {
      return;
    }

    const configuredModel = models.find(
      (model) =>
        model.modelId === configuredDefault &&
        isChatCapableModel(model) &&
        normalizeModelDisplaySurfaces(model.displaySurfaces, model.capability).includes(
          "chat"
        )
    );
    if (!configuredModel) {
      return;
    }

    setSelectedModel((current) =>
      modelSelectionLockedRef.current ? current : configuredModel.modelId
    );
  }, [models, modelsLoaded, publicSettings?.defaultModel]);

  function openImageModelFromLibrary(modelId: string) {
    try {
      window.sessionStorage.setItem(
        imageModelHandoffStorageKey,
        JSON.stringify({
          modelId,
          createdAt: Date.now()
        })
      );
    } catch {
      // Browser storage can be unavailable; navigation still works without leaking the model id.
    }

    router.push("/image");
  }

  async function sendMessageStreaming({
    requestPayload,
    activeSessionIdAtSend,
    isFirstUserMessage,
    firstUserPrompt,
    assistantMessageId,
    safeErrorMessage
  }: {
    requestPayload: ReturnType<typeof buildChatCompletionPayload>;
    activeSessionIdAtSend: string | null;
    isFirstUserMessage: boolean;
    firstUserPrompt: string;
    assistantMessageId: string;
    safeErrorMessage: string;
  }): Promise<boolean> {
    let response: Response;
    const showAssistantError = (message = safeErrorMessage) => {
      setMessages((current) =>
        current.map((currentMessage) =>
          currentMessage.id === assistantMessageId
            ? { ...currentMessage, content: message }
            : currentMessage
        )
      );
    };

    try {
      response = await fetch(apiUrl("/chat/completions/stream"), {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestPayload)
      });
    } catch {
      showAssistantError();
      return false;
    }

    if (!isChatCompletionStreamResponseUsable(response)) {
      showAssistantError();
      return false;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamSessionId = activeSessionIdAtSend;

    try {
      while (true) {
        const { value, done } = await reader.read();
        const decoded = value
          ? decoder.decode(value, { stream: !done })
          : done
            ? decoder.decode()
            : "";
        const parsed = parseChatCompletionStreamChunk({
          buffer,
          chunk: done ? `${decoded}\n\n` : decoded
        });
        buffer = parsed.buffer;

        for (const streamEvent of parsed.events) {
          if (streamEvent.event === "meta") {
            if (streamEvent.data.sessionId) {
              const isFirstSessionId = !streamSessionId || streamSessionId === activeSessionIdAtSend;
              streamSessionId = streamEvent.data.sessionId;
              if (scrollRuntimeOwnerRef.current.sessionId !== streamEvent.data.sessionId) {
                sessionTransitionVersionRef.current += 1;
                transitionChatScrollRuntime(streamEvent.data.sessionId);
                activeSessionIdRef.current = streamEvent.data.sessionId;
                setLoadedMessagesSessionId(null);
                setCurrentSessionId(streamEvent.data.sessionId);
              }
              if (isFirstSessionId) {
                processStreamTitleEvent({
                  event: "meta",
                  eventSessionId: streamEvent.data.sessionId,
                  isFirstUserMessage,
                  firstUserPrompt,
                  fallbackSessionId: activeSessionIdAtSend ?? "",
                  ensureSessionTitle
                });
              }
            }
            continue;
          }

          if (streamEvent.event === "delta") {
            const delta = streamEvent.data.content ?? "";
            if (!delta) {
              continue;
            }
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: `${message.content}${delta}` }
                  : message
              )
            );
            continue;
          }

          if (streamEvent.event === "done") {
            const doneSessionId = streamEvent.data.sessionId ?? streamSessionId;
            const isNewSession = doneSessionId !== activeSessionIdAtSend;
            if (doneSessionId && isNewSession) {
              if (scrollRuntimeOwnerRef.current.sessionId !== doneSessionId) {
                sessionTransitionVersionRef.current += 1;
                transitionChatScrollRuntime(doneSessionId);
                activeSessionIdRef.current = doneSessionId;
                setLoadedMessagesSessionId(null);
              }
              setCurrentSessionId(doneSessionId);
            }

            if (isLoggedIn) {
              ctxRefreshQuota();
              await loadSessions();
              if (doneSessionId) {
                await loadMessages(doneSessionId);
              }
              processStreamTitleEvent({
                event: "done",
                eventSessionId: doneSessionId,
                isFirstUserMessage,
                firstUserPrompt,
                fallbackSessionId: activeSessionIdAtSend ?? "",
                ensureSessionTitle
              });
            }
            return true;
          }

          if (streamEvent.event === "error") {
            showAssistantError(
              streamEvent.data.message?.trim() || safeErrorMessage
            );
            return false;
          }
        }

        if (done) {
          break;
        }
      }
    } catch (streamError) {
      if (streamError instanceof SyntaxError) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: safeErrorMessage }
              : message
          )
        );
        return false;
      }

      showAssistantError();
      return false;
    } finally {
      reader.releaseLock();
    }

    showAssistantError();
    return false;
  }

  async function sendMessage() {
    const content = input.trim();

    if (!canSendMessage) {
      if (guestModeDisabled) {
        setError(t("chat.guestModeDisabled"));
      }
      return;
    }

    const requestModel = resolveRequestModel({
      selectedModel,
      fallbackModel,
      selectedModelInfo
    });
    const modelValidationError = validateModelBeforeSend({
      isLoggedIn,
      remainingCredits: shell.remainingCredits ?? null,
      model: selectedModelInfo,
      locale
    });

    if (modelValidationError) {
      setError(modelValidationError);
      return;
    }

    if (!tryAcquireChatSendLock(sendingRef)) {
      return;
    }

    const isFirstUserMessage = !hasUserMessage(messages);
    const firstUserPrompt = content;
    const draftAtSend = input;
    const persistenceIdentityAtSend = persistenceIdentity;
    const optimisticUserMessage: ChatMessageRecord = {
      id: `local_${Date.now()}`,
      sessionId: activeSessionId ?? "anonymous",
      role: "user",
      content,
      model: requestModel,
      createdAt: new Date().toISOString()
    };
    const requestMessages: ChatMessage[] = [
      ...messages.map(({ role, content: messageContent }) => ({
        role,
        content: messageContent
      })),
      {
        role: "user",
        content
      }
    ];
    const requestPayload = buildChatCompletionPayload({
      sessionId: isLoggedIn ? activeSessionId : null,
      model: requestModel,
      messages: requestMessages
    });
    const assistantMessageId = `local_assistant_${Date.now()}`;
    const optimisticAssistantMessage: ChatMessageRecord = {
      id: assistantMessageId,
      sessionId: activeSessionId ?? "anonymous",
      role: "assistant",
      content: "",
      model: requestModel,
      createdAt: new Date().toISOString()
    };

    setMessages((current) => [
      ...current,
      optimisticUserMessage,
      optimisticAssistantMessage
    ]);
    setError(null);
    setIsLoading(true);

    try {
      if (process.env.NODE_ENV === "development") {
        console.log("[chat request]", {
          oldModel: selectedModel,
          nextModel: selectedModel,
          "request body.model": requestPayload.model,
          messagesLength: requestPayload.messages.length,
          anonymousMode: !isLoggedIn
        });
      }

      const sendSucceeded = await sendMessageStreaming({
        requestPayload,
        activeSessionIdAtSend: activeSessionId,
        isFirstUserMessage,
        firstUserPrompt,
        assistantMessageId,
        safeErrorMessage: t("chat.requestFailed")
      });
      if (sendSucceeded) {
        clearInputDraft(draftAtSend, persistenceIdentityAtSend);
      }
    } catch (sendError) {
      setMessages((current) =>
        current.filter(
          (message) =>
            message.id !== optimisticUserMessage.id &&
            message.id !== assistantMessageId
        )
      );
      setError(sendError instanceof Error ? sendError.message : t("chat.requestFailed"));
    } finally {
      releaseChatSendLock(sendingRef);
      setIsLoading(false);
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      !shouldSubmitOnEnter({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: event.nativeEvent.isComposing
      })
    ) {
      return;
    }

    event.preventDefault();

    if (canSendMessage) {
      void sendMessage();
    }
  }

  const currentTitle = t("chat.window");
  const workspaceIconUrl = getPublicWorkspaceIconUrl(publicSettings);
  const workspaceLogoText = getPublicLogoText(publicSettings);
  const composerSelectedModelLabel = selectedModelDisplayName
    ? selectedModelDisplayName
    : t("chat.loadingModels");
  const composerCreditLabel = selectedModelInfo
    ? selectedModelInfo.creditCost <= 0
      ? formatModelCreditCostLabel(selectedModelInfo.creditCost, locale)
      : locale === "zh-CN"
        ? `${selectedModelInfo.creditCost}额度/次`
        : `${selectedModelInfo.creditCost} credits/msg`
    : null;
  const composerAccessLabel = selectedModelInfo
    ? formatModelAccessLabel(
        selectedModelInfo.allowGuest,
        isLoggedIn,
        locale
      )
    : guestModeDisabled
      ? t("chat.guestModeDisabled")
      : null;
  const chatSidebar = useMemo(
    () => (
      <ChatSidebar
        title={t("chat.title")}
        newChatLabel={t("chat.newChat")}
        historyLabel={t("chat.history")}
        noHistoryLabel={t("chat.noHistory")}
        loginHint={t("chat.loginToSave")}
        loginLabel={t("nav.login")}
        sessions={sessions}
        currentSessionId={currentSessionId}
        isLoggedIn={isLoggedIn}
        deleteLabel={t("chat.deleteSession")}
        featuredModelsLabel={t("workspace.featuredModels")}
        moreModelsLabel={t("workspace.moreModels")}
        collapseSidebarLabel={t("chat.collapseSidebar")}
        expandSidebarLabel={t("chat.expandSidebar")}
        featuredModels={featuredModels}
        modelsPageHref="/models"
        onSelectFeaturedModel={selectModelAndReturnToChat}
        onCreateSession={() => void createSession()}
        onSelectSession={(sessionId) => void selectSession(sessionId)}
        onDeleteSession={(sessionId) => void deleteSession(sessionId)}
      />
    ),
    [
      createSession,
      currentSessionId,
      deleteSession,
      featuredModels,
      isLoggedIn,
      selectModelAndReturnToChat,
      selectSession,
      sessions,
      t
    ]
  );

  useEffect(() => {
    setWorkspaceCurrentTitle(currentTitle);
    setWorkspaceCurrentModelLabel(selectedModelDisplayName);
    setWorkspaceCreateSession(() => void createSession());
    setWorkspaceSidebar(chatSidebar);

    return () => {
      setWorkspaceCurrentTitle(null);
      setWorkspaceCurrentModelLabel(null);
      setWorkspaceCreateSession(null);
      setWorkspaceSidebar(null);
    };
  }, [
    chatSidebar,
    createSession,
    currentTitle,
    selectedModelDisplayName,
    setWorkspaceCreateSession,
    setWorkspaceCurrentModelLabel,
    setWorkspaceCurrentTitle,
    setWorkspaceSidebar
  ]);

  function renderMessageList(mode: "desktop" | "mobile") {
    if (messages.length === 0) {
      return (
        <>
          <EmptyState
            mode={mode}
            headline={workspaceHero.title}
            subtitle={workspaceHero.subtitle}
            promptSuggestionsLabel={t("chat.promptSuggestions")}
            suggestions={promptSuggestions}
            workspaceIconUrl={workspaceIconUrl}
            workspaceIconText={workspaceLogoText}
            onSelectPrompt={setInputDraft}
          />
          {workspaceHint ? (
            <p className="mx-auto -mt-3 max-w-3xl px-4 pb-5 text-center text-xs leading-5 text-slate-500">
              {workspaceHint}
            </p>
          ) : null}
        </>
      );
    }

    return (
       <div className={`${CHAT_CONTENT_CLASS_NAME} grid min-w-0 gap-5 py-5 sm:py-6`}>
        <div className="grid min-w-0 max-w-full gap-4">
          {messages.map((message) => {
            const isUser = message.role === "user";
            const modelIdentity = isUser
              ? null
              : resolveModelIdentity(
                  message.model,
                  models,
                  t("chat.aiAssistant")
                );
            const userSeed = user ? getUserSeed(user) : "guest";

            return (
              <div
                key={message.id}
                id={isUser ? getChatTurnAnchorId(mode, message.id) : undefined}
                data-chat-turn-anchor={isUser ? message.id : undefined}
                className={isUser ? "scroll-mt-6 flex min-w-0 max-w-full justify-end" : "flex min-w-0 max-w-full justify-start"}
              >
                {isUser ? (
                  <div data-message-user-row="true" className="flex min-w-0 max-w-[90%] items-start gap-2 sm:max-w-[76%]">
                    <article
                      className="min-w-0 max-w-full overflow-hidden rounded-3xl rounded-tr-lg bg-indigo-600 px-4 py-3 text-sm leading-7 text-white shadow-sm dark:bg-indigo-700 dark:shadow-none"
                      aria-label={t("chat.userMessage")}
                    >
                      <p className="whitespace-pre-wrap break-words">
                        {message.content}
                      </p>
                    </article>
                    <span className="mt-0.5 shrink-0" data-message-user-avatar="true">
                      <UserAvatar
                        displayName={user?.name}
                        seed={userSeed}
                        avatarUrl={user?.avatarUrl}
                        token={token}
                        isGuest={!isLoggedIn}
                        size="sm"
                      />
                    </span>
                  </div>
                ) : (
                  <div className="flex min-w-0 max-w-[90%] items-start gap-2 sm:max-w-[76%]">
                    {modelIdentity?.model ? (
                      <ModelIcon
                        model={modelIdentity.model}
                        className="mt-0.5 size-7 rounded-full"
                        imageClassName="size-3.5"
                      />
                    ) : (
                      <span
                        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ backgroundColor: modelIdentity?.color ?? "#4f46e5" }}
                        aria-hidden="true"
                      >
                        {modelIdentity ? (
                          <modelIdentity.Icon className="size-3.5" />
                        ) : (
                          <Bot className="size-3.5" />
                        )}
                      </span>
                    )}
                    <article
                      className="min-w-0 max-w-full overflow-hidden rounded-3xl rounded-tl-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:shadow-none"
                    >
                      <div className="mb-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                        <span className="block max-w-48 truncate" title={modelIdentity?.displayName}>
                          {modelIdentity?.displayName ?? t("chat.ai")}
                        </span>
                      </div>
                      {message.content.length === 0 && isLoading ? (
                        <p className="text-slate-500 dark:text-slate-400">{t("chat.generating")}</p>
                      ) : (
                        <AssistantMarkdown
                          content={message.content}
                          messageId={message.id}
                          locale={locale}
                        />
                      )}
                    </article>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {error ? (
          <div className="overflow-hidden rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700 shadow-sm dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            <p className="break-words whitespace-pre-wrap">{error}</p>
          </div>
        ) : null}
      </div>
    );
  }

  function handleReturnToBottom(mode: ChatScrollSurface) {
    if (!ownsChatSurface(workspaceSurface, mode)) {
      return;
    }
    if (
      !ownsChatPersistenceIdentity(
        scrollRuntimeOwnerRef.current.identity,
        persistenceIdentity
      ) ||
      scrollRuntimeOwnerRef.current.sessionId !== activeSessionId
    ) {
      return;
    }

    const container = mode === "mobile"
      ? mobileMessageViewportRef.current
      : messageViewportRef.current;

    if (!container) {
      return;
    }

    const top = container.scrollHeight;
    container.scrollTo({ top, behavior: "smooth" });
    writeChatScrollTop(persistenceIdentity, activeSessionId, mode, top);

    if (mode === "mobile") {
      shouldFollowMobileBottomRef.current = true;
      lastMobileScrollTopRef.current = top;
      hasMobileScrollPositionRef.current = true;
      setIsMobileAwayFromBottom(false);
    } else {
      shouldFollowDesktopBottomRef.current = true;
      lastDesktopScrollTopRef.current = top;
      hasDesktopScrollPositionRef.current = true;
      setIsDesktopAwayFromBottom(false);
    }
  }

  function renderChatSurface(
    composerTextareaRef: RefObject<HTMLTextAreaElement | null>,
    mode: "desktop" | "mobile"
  ) {
    return (
      <section
        className={
          mode === "mobile"
            ? "flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-slate-950"
            : "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white dark:bg-slate-950"
        }
      >
        <div className="relative flex min-h-0 min-w-0 flex-1">
          <div
            ref={mode === "desktop" ? messageViewportRef : mobileMessageViewportRef}
            data-chat-message-scroll-container="true"
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-slate-50 dark:bg-slate-950"
            onScroll={(event) => {
              if (!ownsChatSurface(workspaceSurface, mode)) {
                return;
              }
              if (
                !ownsChatPersistenceIdentity(
                  scrollRuntimeOwnerRef.current.identity,
                  persistenceIdentity
                ) ||
                scrollRuntimeOwnerRef.current.sessionId !== activeSessionId
              ) {
                return;
              }

              const container = event.currentTarget;
              const shouldFollow = isNearBottom(container);
              if (mode === "mobile") {
                shouldFollowMobileBottomRef.current = shouldFollow;
                lastMobileScrollTopRef.current = container.scrollTop;
                hasMobileScrollPositionRef.current = true;
                setIsMobileAwayFromBottom(!shouldFollow);
              } else {
                shouldFollowDesktopBottomRef.current = shouldFollow;
                lastDesktopScrollTopRef.current = container.scrollTop;
                hasDesktopScrollPositionRef.current = true;
                setIsDesktopAwayFromBottom(!shouldFollow);
              }
              writeChatScrollTop(
                persistenceIdentity,
                activeSessionId,
                mode,
                container.scrollTop
              );
            }}
          >
            {renderMessageList(mode)}
          </div>
          {(mode === "mobile" ? isMobileAwayFromBottom : isDesktopAwayFromBottom) ? (
            <button
              type="button"
              data-chat-return-to-bottom={mode}
              aria-label={t("chat.returnToBottom")}
              title={t("chat.returnToBottom")}
              onClick={() => handleReturnToBottom(mode)}
              className="absolute bottom-4 right-4 z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 p-2 text-indigo-700 shadow-lg shadow-slate-900/10 backdrop-blur transition hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-900/95 dark:text-indigo-300 dark:hover:bg-slate-800"
            >
              <ArrowDown className="size-5" aria-hidden="true" />
            </button>
          ) : null}
          {mode === "desktop" ? (
            <ChatOutline
              messages={messages}
              messageScrollContainerRef={messageViewportRef}
              onBeforeNavigate={() => {
                shouldFollowDesktopBottomRef.current = false;
                setIsDesktopAwayFromBottom(true);
              }}
              title={t("chat.outlineTitle")}
              ariaLabel={t("chat.outlineAriaLabel")}
            />
          ) : null}
        </div>

        <ChatComposer
          textareaRef={composerTextareaRef}
          modelTriggerRef={modelTriggerRef}
          value={input}
          placeholder={workspacePromptPlaceholder}
          selectedModelLabel={composerSelectedModelLabel}
          switchModelLabel={t("chat.switchModel")}
          creditLabel={composerCreditLabel}
          accessLabel={composerAccessLabel}
          sendLabel={t("chat.send")}
          sendingLabel={t("chat.sending")}
          clearLabel={t("chat.clearDraft")}
          expandLabel={t("chat.editPrompt")}
          closeExpandedLabel={t("chat.closePromptEditor")}
          expandedTitle={t("chat.promptEditorTitle")}
          isLoading={isLoading}
          canSend={canSendMessage}
          onChange={setInputDraft}
          onClear={clearInputDraft}
          onKeyDown={handleInputKeyDown}
          onOpenModelSelector={() => setIsModelSelectorOpen(true)}
          onSend={() => void sendMessage()}
        />
      </section>
    );
  }

  return (
    <>
      {ownedChatSurfaces.includes("mobile") ? (
        <div className="flex min-h-0 flex-1 flex-col md:hidden">
          <header
            className="flex shrink-0 items-center justify-between bg-slate-50 px-5 pb-3 pt-5 dark:bg-slate-950"
            data-mobile-chat-header="true"
          >
            <h1 className="text-xl font-semibold text-slate-950 dark:text-slate-100">
              {t("workspace.chat")}
            </h1>
            <div className="flex items-center gap-2">
              <Link
                href="/chat/history"
                aria-label={t("chat.history")}
                className="inline-flex size-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-700 dark:hover:text-indigo-300"
              >
                <History className="size-5" aria-hidden="true" />
              </Link>
              <button
                type="button"
                aria-label={t("chat.newChat")}
                onClick={() => void createSession()}
                className="inline-flex size-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-700 dark:hover:text-indigo-300"
              >
                <Plus className="size-5" aria-hidden="true" />
              </button>
            </div>
          </header>
          {renderChatSurface(mobileTextareaRef, "mobile")}
        </div>
      ) : null}
      {ownedChatSurfaces.includes("desktop") ? (
        <div className="hidden h-full min-h-0 md:block">
          {renderChatSurface(desktopTextareaRef, "desktop")}
        </div>
      ) : null}
      <ModelSelectorDialog
        isOpen={isModelSelectorOpen}
        models={models}
        selectedModel={selectedModel}
        context="chat-selector"
        isLoggedIn={isLoggedIn}
        searchQuery={modelSearchQuery}
        onSearchChange={setModelSearchQuery}
        onClose={() => setIsModelSelectorOpen(false)}
        returnFocusRef={modelTriggerRef}
        onSelectModel={selectModelAndReturnToChat}
      />
      <ConfirmDialog
        isOpen={isDiscardDraftOpen}
        title={t("chat.confirmDiscardTitle")}
        message={t("chat.confirmDiscardMessage")}
        confirmLabel={t("chat.confirm")}
        cancelLabel={t("chat.cancel")}
        onConfirm={handleDiscardDraftConfirm}
        onCancel={handleDiscardDraftCancel}
      />
    </>
  );
}
