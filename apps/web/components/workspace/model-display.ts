import { getModelDisplayName, type AiModelSummary } from "@ai-aggregate/shared";

export function resolveSelectedModelDisplayLabel({
  models,
  selectedModel,
  modelsLoaded
}: {
  models: AiModelSummary[];
  selectedModel: string;
  modelsLoaded: boolean;
}): string | null {
  if (!modelsLoaded) {
    return null;
  }

  const selected = models.find((model) => model.modelId === selectedModel);

  return selected ? getModelDisplayName(selected) : null;
}
