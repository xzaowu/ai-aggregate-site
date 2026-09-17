import {
  isChatCapableModel,
  normalizeModelDisplaySurfaces,
  type AiModelSummary
} from "@ai-aggregate/shared";
import type {
  CreatorCanvasDocumentV1,
  CreatorTextAiConfig
} from "./creator-canvas-document";

export type CreatorTextAiExecutionValidation =
  | { ok: true; modelId: string }
  | { ok: false; reason: "blank-instruction" | "no-model" };

export type CreatorTextAiCompletionResult =
  | { ok: true; content: string }
  | { ok: false; reason: "malformed" | "blank" };

export function cloneCreatorTextAiConfig(
  config: CreatorTextAiConfig | undefined
): CreatorTextAiConfig | undefined {
  return config
    ? { instruction: config.instruction, modelId: config.modelId }
    : undefined;
}

export function filterCreatorTextAiModels(
  models: readonly AiModelSummary[]
): AiModelSummary[] {
  return models.filter((model) =>
    model.enabled !== false &&
    isChatCapableModel(model) &&
    normalizeModelDisplaySurfaces(model.displaySurfaces, model.capability)
      .includes("chat")
  );
}

export function resolveCreatorTextAiModel(
  savedModelId: string | undefined,
  models: readonly AiModelSummary[]
): AiModelSummary | null {
  const configured = savedModelId?.trim() ?? "";
  return models.find((model) =>
    configured.length > 0 &&
    (model.modelId === configured || model.slug === configured)
  ) ?? models[0] ?? null;
}

export function getCreatorTextAiEffectiveModelId(
  savedModelId: string | undefined,
  models: readonly AiModelSummary[]
): string | null {
  return resolveCreatorTextAiModel(savedModelId, models)?.modelId ?? null;
}

export function getCreatorTextAiIncomingTextOutputs(
  document: CreatorCanvasDocumentV1,
  targetNodeId: string
): string[] {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  return document.edges.flatMap((edge) => {
    if (edge.targetNodeId !== targetNodeId) return [];
    const source = nodeById.get(edge.sourceNodeId);
    if (source?.kind !== "text") return [];
    const text = source.data.text.trim();
    return text.length > 0 ? [text] : [];
  });
}

export function compileCreatorTextAiPrompt(
  document: CreatorCanvasDocumentV1,
  targetNodeId: string,
  instruction: string
): string {
  const outputs = getCreatorTextAiIncomingTextOutputs(document, targetNodeId);
  const context = outputs.length === 0
    ? "context:"
    : `context:\n${outputs.map((output, index) => `[${index + 1}]\n${output}`).join("\n\n")}`;
  return `${context}\n\ninstruction:\n${instruction.trim()}`;
}

export function validateCreatorTextAiExecution({
  instruction,
  modelId
}: {
  instruction: string;
  modelId: string | null;
}): CreatorTextAiExecutionValidation {
  if (instruction.trim().length === 0) {
    return { ok: false, reason: "blank-instruction" };
  }
  if (!modelId || modelId.trim().length === 0) {
    return { ok: false, reason: "no-model" };
  }
  return { ok: true, modelId: modelId.trim() };
}

export function parseCreatorTextAiCompletionResponse(
  value: unknown
): CreatorTextAiCompletionResult {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as { content?: unknown }).content !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }
  const content = (value as { content: string }).content.trim();
  return content.length > 0
    ? { ok: true, content }
    : { ok: false, reason: "blank" };
}
