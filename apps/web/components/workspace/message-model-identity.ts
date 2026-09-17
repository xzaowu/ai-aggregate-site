import {
  getModelDisplayName,
  type AiModelRouteSummary,
  type PublicAiModelSummary
} from "@ai-aggregate/shared";
import { Bot, Brain, Sparkles, MessageSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type ModelIdentityRoute = Pick<AiModelRouteSummary, "id" | "upstreamModel">;

type ModelIdentityCandidate = Pick<
  PublicAiModelSummary,
  | "name"
  | "displayName"
  | "slug"
  | "provider"
  | "modelId"
  | "iconColor"
> & {
  routes?: readonly ModelIdentityRoute[];
};

export interface ModelIdentity<
  TModel extends ModelIdentityCandidate = PublicAiModelSummary
> {
  displayName: string;
  model: TModel | null;
  Icon: LucideIcon;
  color: string;
}

const MODEL_FAMILY_ICONS: Record<string, { Icon: LucideIcon; color: string }> = {
  openai: { Icon: Sparkles, color: "#10a37f" },
  deepseek: { Icon: Brain, color: "#4f46e5" },
  gemini: { Icon: Sparkles, color: "#1a73e8" },
  claude: { Icon: MessageSquare, color: "#d97706" },
  qwen: { Icon: Brain, color: "#615eed" },
  glm: { Icon: Bot, color: "#3b82f6" },
  gpt: { Icon: Sparkles, color: "#10a37f" },
  llama: { Icon: Brain, color: "#7c3aed" },
  mistral: { Icon: MessageSquare, color: "#f97316" }
};

const DEFAULT_FALLBACK: { Icon: LucideIcon; color: string } = {
  Icon: Bot,
  color: "#4f46e5"
};

const MODEL_FAMILY_LABELS: Record<string, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  claude: "Claude",
  qwen: "Qwen",
  glm: "GLM",
  gpt: "GPT",
  llama: "Llama",
  mistral: "Mistral"
};

function detectFamilyKey(modelName: string): string {
  const lower = modelName.toLowerCase();
  for (const [key] of Object.entries(MODEL_FAMILY_ICONS)) {
    if (lower.includes(key)) {
      return key;
    }
  }
  return "";
}

function formatRecognizedModelName(modelName: string, familyKey: string): string {
  const identifier = modelName.trim().split("/").pop()?.replaceAll("_", "-") ?? "";

  if (identifier.toLowerCase().startsWith("gpt-")) {
    const [, version, ...suffixParts] = identifier.split("-");
    if (version) {
      const suffix = suffixParts
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(" ");
      return `GPT-${version}${suffix ? ` ${suffix}` : ""}`;
    }
  }

  return MODEL_FAMILY_LABELS[familyKey] ?? "AI Assistant";
}

export function resolveModelIdentity<TModel extends ModelIdentityCandidate>(
  modelField: string | undefined,
  models: readonly TModel[],
  fallbackLabel = "AI Assistant"
): ModelIdentity<TModel> {
  const fallback = {
    displayName: fallbackLabel,
    model: null,
    ...DEFAULT_FALLBACK
  };

  if (!modelField) {
    return fallback;
  }

  const matchedModel = models.find(
    (model) =>
      model.modelId === modelField ||
      model.slug === modelField ||
      model.routes?.some(
        (route) =>
          route.id === modelField || route.upstreamModel === modelField
      )
  );

  if (matchedModel) {
    const displayName = getModelDisplayName(matchedModel);
    const familyKey = detectFamilyKey(
      matchedModel.displayName ||
        matchedModel.name ||
        matchedModel.provider ||
        modelField
    );
    const family =
      MODEL_FAMILY_ICONS[familyKey] ||
      (matchedModel.iconColor
        ? { Icon: Brain, color: matchedModel.iconColor }
        : DEFAULT_FALLBACK);

    return {
      displayName,
      model: matchedModel,
      Icon: family.Icon,
      color: family.color
    };
  }

  const familyKey = detectFamilyKey(modelField);
  if (familyKey) {
    const family = MODEL_FAMILY_ICONS[familyKey] ?? DEFAULT_FALLBACK;
    return {
      displayName: formatRecognizedModelName(modelField, familyKey),
      model: null,
      Icon: family.Icon,
      color: family.color
    };
  }

  return fallback;
}
