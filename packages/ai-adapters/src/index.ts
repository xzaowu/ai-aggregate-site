import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionUsage,
  ChatMessage,
  AiGenerationCount,
  AiGenerationSize,
  ImageReferenceInput
} from "@ai-aggregate/shared";
import {
  joinProviderEndpointUrl,
  normalizeProviderHeaders
} from "@ai-aggregate/shared";
import Anthropic, {
  APIConnectionError as AnthropicAPIConnectionError,
  APIConnectionTimeoutError as AnthropicAPIConnectionTimeoutError,
  APIError as AnthropicAPIError,
  APIUserAbortError as AnthropicAPIUserAbortError,
  AnthropicError
} from "@anthropic-ai/sdk";
import type { MessageParam as AnthropicMessageParam } from "@anthropic-ai/sdk/resources/messages";
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  OpenAIError,
  toFile
} from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export interface OpenAICompatibleAdapterConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  imageResponseFormat?: ImageResponseFormat;
  timeoutMs?: number;
  batchTimeoutMs?: number;
  headersJson?: Record<string, unknown> | null;
  fetchImpl?: typeof fetch;
}

export type ImageResponseFormat = "url" | "b64_json";

export interface AnthropicChatAdapterConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  maxTokens?: number;
  headersJson?: Record<string, unknown> | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type AnthropicAuthMode = "x-api-key" | "bearer" | "both";

export interface ChatCompletionAdapterRequest extends ChatCompletionRequest {
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface ChatCompletionAdapter {
  createChatCompletion(
    request: ChatCompletionAdapterRequest
  ): Promise<ChatCompletionResponse>;
}

export interface StreamChatCompletionDelta {
  content: string;
}

export type StreamDeltaHandler = (
  delta: StreamChatCompletionDelta
) => void | Promise<void>;

export interface StreamChatCompletionInput extends ChatCompletionAdapterRequest {
  onDelta?: StreamDeltaHandler;
}

export interface StreamChatCompletionResult {
  content: string;
  model: string;
}

export interface StreamingChatCompletionAdapter {
  createStreamingChatCompletion(
    request: StreamChatCompletionInput
  ): Promise<StreamChatCompletionResult>;
}

export class AIProviderRequestError extends Error {
  readonly statusCode?: number;
  readonly endpointPath?: string;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      endpointPath?: string;
      retryAfterMs?: number;
    }
  ) {
    super(message);
    this.name = "AIProviderRequestError";
    this.statusCode = options.statusCode;
    this.endpointPath = options.endpointPath;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class AIProviderRouteUnavailableError extends AIProviderRequestError {
  constructor(options: { statusCode?: number; endpointPath?: string }) {
    super("AI provider request failed", options);
    this.name = "AIProviderRouteUnavailableError";
  }
}

export class AIProviderResponseFormatError extends Error {
  constructor() {
    super("AI provider response format is invalid");
    this.name = "AIProviderResponseFormatError";
  }
}

export class AIProviderTimeoutError extends Error {
  constructor() {
    super("AI provider request timed out");
    this.name = "AIProviderTimeoutError";
  }
}

export class AIProviderSubmissionUncertainError extends Error {
  constructor() {
    super("AI provider submission outcome is uncertain");
    this.name = "AIProviderSubmissionUncertainError";
  }
}

export class AIProviderAbortError extends Error {
  constructor() {
    super("AI provider request cancelled");
    this.name = "AIProviderAbortError";
  }
}

class AIProviderPlatformCallbackError extends Error {
  readonly originalError: unknown;

  constructor(originalError: unknown) {
    super("AI platform stream callback failed");
    this.name = "AIProviderPlatformCallbackError";
    this.originalError = originalError;
  }
}

export type ImageTransport = "openai-images" | "legacy-extra-body-v1";

export class ImageTransportConfigError extends Error {
  constructor() {
    super("IMAGE_TRANSPORT_INVALID");
    this.name = "ImageTransportConfigError";
  }
}

export function resolveImageTransport(input: {
  providerType: string;
  configJson: unknown;
}): ImageTransport {
  if (isProviderRecord(input.configJson)) {
    const configured = input.configJson.imageTransport;
    if (Object.prototype.hasOwnProperty.call(input.configJson, "imageTransport")) {
      if (
        configured === "openai-images" ||
        configured === "legacy-extra-body-v1"
      ) {
        return configured;
      }
      throw new ImageTransportConfigError();
    }
  }

  return input.providerType === "AGNES_IMAGE"
    ? "legacy-extra-body-v1"
    : "openai-images";
}

export interface GeneratedImageResult {
  sourceType: "url";
  url: string;
  revisedPrompt?: string;
}

export interface GeneratedBase64ImageResult {
  sourceType: "base64";
  base64: string;
  revisedPrompt?: string;
}

export type GeneratedImageOutput =
  | GeneratedImageResult
  | GeneratedBase64ImageResult;

export interface GeneratedImageDataUrl {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  dataUrl: string;
  base64Data: string;
}

const STRICT_GENERATED_IMAGE_BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const GENERATED_IMAGE_DATA_URL_RE =
  /^data:(image\/(?:png|jpeg|webp));base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/u;

export function isValidGeneratedImageBase64(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    STRICT_GENERATED_IMAGE_BASE64_RE.test(value)
  );
}

export function isValidGeneratedImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

export function parseGeneratedImageDataUrl(
  value: unknown
): GeneratedImageDataUrl | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = GENERATED_IMAGE_DATA_URL_RE.exec(value.trim());
  const mimeType = match?.[1];
  const base64Data = match?.[2];

  if (
    (mimeType !== "image/png" &&
      mimeType !== "image/jpeg" &&
      mimeType !== "image/webp") ||
    base64Data === undefined ||
    !isValidGeneratedImageBase64(base64Data)
  ) {
    return null;
  }

  return {
    mimeType,
    dataUrl: value.trim(),
    base64Data
  };
}

const OPENAI_REFERENCE_FILE_NAMES = {
  "image/png": "reference.png",
  "image/jpeg": "reference.jpg",
  "image/webp": "reference.webp"
} as const;

async function toOpenAIImageUpload(
  referenceImage: ImageReferenceInput
): Promise<File> {
  const mimeType = referenceImage.mimeType.trim().toLowerCase();
  const fileName =
    OPENAI_REFERENCE_FILE_NAMES[
      mimeType as keyof typeof OPENAI_REFERENCE_FILE_NAMES
    ];
  const parsed = parseGeneratedImageDataUrl(referenceImage.dataUrl);

  if (!fileName || !parsed || parsed.mimeType !== mimeType) {
    throw new AIProviderResponseFormatError();
  }

  return toFile(
    Buffer.from(parsed.base64Data, "base64"),
    fileName,
    { type: mimeType }
  );
}

export interface ImageGenerationResult {
  images: GeneratedImageOutput[];
}

export interface ImageGenerationAdapterRequest {
  model: string;
  prompt: string;
  size: AiGenerationSize;
  count: AiGenerationCount;
  referenceImages?: readonly ImageReferenceInput[];
  signal?: AbortSignal;
}

export interface ImageGenerationAdapter {
  createImageGeneration(
    request: ImageGenerationAdapterRequest
  ): Promise<ImageGenerationResult>;
}

function toGeneratedImageOutput(
  item: Record<string, unknown>,
  preferredResponseFormat: ImageResponseFormat = "url",
  fallbackToAlternateFormat = false
): GeneratedImageOutput | null {
  const revisedPromptValue = item.revised_prompt;
  const revisedPrompt =
    typeof revisedPromptValue === "string"
      ? { revisedPrompt: revisedPromptValue }
      : {};

  const base64Output = (): GeneratedImageOutput | null => {
    const base64 = item.b64_json;
    if (!isValidGeneratedImageBase64(base64)) {
      return null;
    }

    return {
      sourceType: "base64",
      base64,
      ...revisedPrompt
    };
  };

  const urlOutput = (): GeneratedImageOutput | null => {
    const url = item.url;
    if (typeof url !== "string" || url.trim().length === 0) {
      return null;
    }

    const parsedDataUrl = parseGeneratedImageDataUrl(url);

    if (parsedDataUrl) {
      return {
        sourceType: "base64",
        base64: parsedDataUrl.base64Data,
        ...revisedPrompt
      };
    }

    if (!isValidGeneratedImageUrl(url)) {
      return null;
    }

    return {
      sourceType: "url",
      url,
      ...revisedPrompt
    };
  };

  if (preferredResponseFormat === "b64_json") {
    return base64Output() ?? (fallbackToAlternateFormat ? urlOutput() : null);
  }

  return urlOutput() ?? base64Output();
}

function isProviderRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function parseProviderImageOutputs(
  payload: unknown,
  preferredResponseFormat: ImageResponseFormat,
  fallbackToAlternateFormat = false,
  maxOutputs?: number
): GeneratedImageOutput[] {
  if (!isProviderRecord(payload) || !Array.isArray(payload.data)) {
    throw new AIProviderResponseFormatError();
  }

  const images = payload.data
    .map((item) =>
      isProviderRecord(item)
        ? toGeneratedImageOutput(
            item,
            preferredResponseFormat,
            fallbackToAlternateFormat
          )
        : null
    )
    .filter((item): item is GeneratedImageOutput => item !== null);

  if (images.length === 0) {
    throw new AIProviderResponseFormatError();
  }

  return maxOutputs === undefined ? images : images.slice(0, maxOutputs);
}

function isValidPositiveTimeoutMs(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function normalizeSdkChatTransportError(
  error: unknown,
  signal: AbortSignal | undefined,
  endpointPath: string
): never {
  if (error instanceof AIProviderPlatformCallbackError) {
    throw error.originalError;
  }

  if (signal?.aborted || error instanceof AIProviderAbortError) {
    throw new AIProviderAbortError();
  }

  if (error instanceof AIProviderTimeoutError) {
    throw error;
  }

  if (
    error instanceof APIConnectionTimeoutError ||
    error instanceof AnthropicAPIConnectionTimeoutError
  ) {
    throw new AIProviderTimeoutError();
  }

  if (error instanceof AIProviderRequestError) {
    throw error;
  }

  if (error instanceof AIProviderResponseFormatError || error instanceof SyntaxError) {
    throw new AIProviderResponseFormatError();
  }

  if (
    error instanceof APIUserAbortError ||
    error instanceof AnthropicAPIUserAbortError ||
    isAbortError(error)
  ) {
    throw new AIProviderAbortError();
  }

  if (error instanceof APIError || error instanceof AnthropicAPIError) {
    if (isModelUnavailableSdkError(error)) {
      throw new AIProviderRouteUnavailableError({
        statusCode: typeof error.status === "number" ? error.status : undefined,
        endpointPath
      });
    }

    throw new AIProviderRequestError("AI provider request failed", {
      statusCode: typeof error.status === "number" ? error.status : undefined,
      endpointPath
    });
  }

  if (
    error instanceof APIConnectionError ||
    error instanceof AnthropicAPIConnectionError
  ) {
    throw new AIProviderRequestError("AI provider request failed", {
      endpointPath
    });
  }

  if (error instanceof OpenAIError) {
    throw new AIProviderResponseFormatError();
  }

  if (error instanceof AnthropicError) {
    throw new AIProviderResponseFormatError();
  }

  throw new AIProviderRequestError("AI provider request failed", {
    endpointPath
  });
}

async function notifyPlatformStreamDelta(
  onDelta: StreamDeltaHandler | undefined,
  content: string
): Promise<void> {
  try {
    await onDelta?.({ content });
  } catch (error) {
    throw new AIProviderPlatformCallbackError(error);
  }
}

function createProviderHttpError(
  statusCode: number,
  endpointPath: string
): AIProviderRequestError {
  return new AIProviderRequestError("AI provider request failed", {
    statusCode,
    endpointPath
  });
}

function isModelUnavailableMessage(message: string): boolean {
  if (
    /\b(?:authentication|unauthorized|forbidden|permission|access\s+denied|api\s*key|invalid\s+(?:api\s*key|token|request)|bad\s+request|request\s+format)\b/iu.test(
      message
    )
  ) {
    return false;
  }

  return /\b(?:model\s+(?:not\s+found|does\s+not\s+exist|unavailable|not\s+available)|invalid\s+model|no\s+such\s+model|unsupported\s+model|upstream\s+unavailable)\b/iu.test(
    message
  );
}

function isModelUnavailableProviderBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as unknown;
    if (!isProviderRecord(payload)) {
      return isModelUnavailableMessage(body);
    }

    const messages: string[] = [];
    if (typeof payload.message === "string") {
      messages.push(payload.message);
    }

    if (isProviderRecord(payload.error)) {
      const code =
        typeof payload.error.code === "string"
          ? payload.error.code.toLowerCase()
          : undefined;
      if (
        code === "model_not_found" ||
        code === "model_not_available" ||
        code === "invalid_model"
      ) {
        return true;
      }
      if (typeof payload.error.message === "string") {
        messages.push(payload.error.message);
      }
    } else if (typeof payload.error === "string") {
      messages.push(payload.error);
    }

    return messages.some((message) => isModelUnavailableMessage(message));
  } catch {
    return isModelUnavailableMessage(body);
  }
}

function isModelUnavailableSdkError(
  error: APIError | AnthropicAPIError
): boolean {
  if (
    error instanceof APIError &&
    typeof error.code === "string" &&
    ["model_not_found", "model_not_available", "invalid_model"].includes(
      error.code.toLowerCase()
    )
  ) {
    return true;
  }

  const errorBody = (() => {
    try {
      return JSON.stringify(error.error) ?? "";
    } catch {
      return "";
    }
  })();

  return (
    (errorBody.length > 0 && isModelUnavailableProviderBody(errorBody)) ||
    isModelUnavailableMessage(error.message)
  );
}

function isJsonContentType(value: string | null): boolean {
  const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || mediaType?.endsWith("+json") === true;
}

function readAmbientOpenAICustomHeaderNames(): Set<string> {
  const names = new Set<string>();
  for (const line of process.env.OPENAI_CUSTOM_HEADERS?.split("\n") ?? []) {
    const colon = line.indexOf(":");
    const name = colon >= 0 ? line.slice(0, colon).trim().toLowerCase() : "";
    if (name) {
      names.add(name);
    }
  }
  return names;
}

function readAmbientAnthropicCustomHeaderNames(): Set<string> {
  const names = new Set<string>();
  for (const line of process.env.ANTHROPIC_CUSTOM_HEADERS?.split("\n") ?? []) {
    const colon = line.indexOf(":");
    const name = colon >= 0 ? line.slice(0, colon).trim().toLowerCase() : "";
    if (name) {
      names.add(name);
    }
  }
  return names;
}

function toProviderFetchHeaders(
  headers: HeadersInit | undefined,
  ambientHeaderNames: ReadonlySet<string>,
  safeCustomHeaders: Record<string, string>,
  apiKey: string,
  body: BodyInit | null | undefined
): Headers {
  const normalized = new Headers();
  new Headers(headers).forEach((value, name) => {
    const lowerName = name.toLowerCase();
    if (
      ambientHeaderNames.has(lowerName) ||
      lowerName === "authorization" ||
      lowerName === "content-type"
    ) {
      return;
    }
    normalized.set(name, value);
  });
  for (const [name, value] of Object.entries(safeCustomHeaders)) {
    normalized.set(name, value);
  }
  normalized.set("Authorization", `Bearer ${apiKey}`);
  if (!(typeof FormData !== "undefined" && body instanceof FormData)) {
    normalized.set("Content-Type", "application/json");
  }
  return normalized;
}

function toAnthropicProviderFetchHeaders(
  headers: HeadersInit | undefined,
  ambientHeaderNames: ReadonlySet<string>,
  safeCustomHeaders: Record<string, string>,
  apiKey: string
): Headers {
  const normalized = new Headers();
  new Headers(headers).forEach((value, name) => {
    const lowerName = name.toLowerCase();
    if (
      ambientHeaderNames.has(lowerName) ||
      lowerName === "authorization" ||
      lowerName === "content-type" ||
      lowerName === "x-api-key" ||
      lowerName === "anthropic-version"
    ) {
      return;
    }
    normalized.set(name, value);
  });
  for (const [name, value] of Object.entries(safeCustomHeaders)) {
    const lowerName = name.toLowerCase();
    if (
      lowerName !== "authorization" &&
      lowerName !== "content-type" &&
      lowerName !== "x-api-key" &&
      lowerName !== "anthropic-version"
    ) {
      normalized.set(name, value);
    }
  }
  normalized.set("Content-Type", "application/json");
  normalized.set("x-api-key", apiKey);
  normalized.set("anthropic-version", "2023-06-01");
  return normalized;
}

function normalizeSdkJsonResponseContentType(response: Response): Response {
  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    !response.ok ||
    isJsonContentType(response.headers.get("content-type")) ||
    mediaType === "text/event-stream"
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  });
}

function normalizeOpenAIImageError(
  error: unknown,
  signal: AbortSignal | undefined,
  endpointPath = "/images/generations",
  abortAsAbortError = false
): never {
  if (error instanceof AIProviderResponseFormatError) {
    throw error;
  }

  if (error instanceof AIProviderAbortError) {
    throw error;
  }

  if (error instanceof APIConnectionTimeoutError) {
    throw new AIProviderTimeoutError();
  }

  if (
    signal?.aborted ||
    error instanceof APIUserAbortError ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    throw abortAsAbortError
      ? new AIProviderAbortError()
      : new AIProviderTimeoutError();
  }

  if (error instanceof APIError) {
    throw new AIProviderRequestError("AI provider request failed", {
      statusCode:
        typeof error.status === "number" ? error.status : undefined,
      endpointPath
    });
  }

  if (error instanceof APIConnectionError) {
    throw new AIProviderRequestError("AI provider request failed", {
      endpointPath
    });
  }

  if (error instanceof SyntaxError) {
    throw new AIProviderResponseFormatError();
  }

  throw new AIProviderRequestError("AI provider request failed", {
    endpointPath
  });
}

export interface ParsedChatFormatImage {
  sourceType: "data-url" | "url";
  mimeType?: string;
  altText?: string;
  url?: string;
  dataUrl?: string;
  base64Data?: string;
}

const MARKDOWN_IMAGE_RE =
  /!\[([^\]]*)\]\(([^)]+)\)/g;

const RAW_DATA_URL_RE =
  /data:image\/[\w.+-]+;base64,[A-Za-z0-9+/]+=*/g;

export function parseChatFormatImageOutputs(
  text: string
): ParsedChatFormatImage[] {
  if (typeof text !== "string" || text.trim().length === 0) {
    return [];
  }

  const markdownRanges: Array<{ start: number; end: number }> = [];
  const locatedResults: Array<{
    index: number;
    image: ParsedChatFormatImage;
  }> = [];

  // Pass 1: Markdown images ![alt](url)
  let altMdMatch: RegExpExecArray | null;
  const mdImageRe = new RegExp(MARKDOWN_IMAGE_RE.source, "g");

  while ((altMdMatch = mdImageRe.exec(text)) !== null) {
    const altText = altMdMatch[1] || undefined;
    const href = altMdMatch[2];

    if (!href) {
      continue;
    }

    const normalizedHref = href.trim();

    if (!normalizedHref) {
      continue;
    }

    markdownRanges.push({
      start: altMdMatch.index,
      end: mdImageRe.lastIndex
    });

    const parsedDataUrl = parseGeneratedImageDataUrl(normalizedHref);

    if (parsedDataUrl) {
      const dataUrl = normalizedHref;
      locatedResults.push({
        index: altMdMatch.index,
        image: {
          sourceType: "data-url",
          mimeType: parsedDataUrl.mimeType,
          altText,
          dataUrl,
          base64Data: parsedDataUrl.base64Data
        }
      });
    } else if (isValidGeneratedImageUrl(normalizedHref)) {
      locatedResults.push({
        index: altMdMatch.index,
        image: {
          sourceType: "url",
          altText,
          url: normalizedHref
        }
      });
    }
  }

  // Pass 2: raw data URLs not already captured via markdown
  let rawMatch: RegExpExecArray | null;
  const rawDataUrlRe = new RegExp(RAW_DATA_URL_RE.source, "g");

  while ((rawMatch = rawDataUrlRe.exec(text)) !== null) {
    const dataUrl = rawMatch[0];

    if (
      markdownRanges.some(
        (range) => rawMatch!.index >= range.start && rawMatch!.index < range.end
      )
    ) {
      continue;
    }

    const parsed = parseGeneratedImageDataUrl(dataUrl);

    if (!parsed) {
      continue;
    }

    locatedResults.push({
      index: rawMatch.index,
      image: {
        sourceType: "data-url",
        mimeType: parsed.mimeType,
        dataUrl,
        base64Data: parsed.base64Data
      }
    });
  }

  return locatedResults
    .sort((left, right) => left.index - right.index)
    .map(({ image }) => image);
}

function parseChatFormatStructuredImage(
  value: unknown
): ParsedChatFormatImage | null {
  if (!isProviderRecord(value)) {
    return null;
  }

  const imageUrl = isProviderRecord(value.image_url)
    ? value.image_url
    : null;
  const source = isProviderRecord(value.source) ? value.source : null;
  const url =
    (imageUrl && typeof imageUrl.url === "string" ? imageUrl.url : undefined) ??
    (source && typeof source.url === "string" ? source.url : undefined) ??
    (typeof value.url === "string" ? value.url : undefined);

  if (url !== undefined) {
    const parsedDataUrl = parseGeneratedImageDataUrl(url);
    if (parsedDataUrl) {
      return {
        sourceType: "data-url",
        mimeType: parsedDataUrl.mimeType,
        dataUrl: parsedDataUrl.dataUrl,
        base64Data: parsedDataUrl.base64Data
      };
    }

    return isValidGeneratedImageUrl(url)
      ? { sourceType: "url", url }
      : null;
  }

  if (!source || source.type !== "base64" || typeof source.data !== "string") {
    return null;
  }

  const mimeType =
    typeof source.media_type === "string"
      ? source.media_type
      : typeof source.mime_type === "string"
        ? source.mime_type
        : undefined;
  if (mimeType === undefined) {
    return null;
  }

  const parsedDataUrl = parseGeneratedImageDataUrl(
    `data:${mimeType};base64,${source.data}`
  );
  if (!parsedDataUrl) {
    return null;
  }

  return {
    sourceType: "data-url",
    mimeType: parsedDataUrl.mimeType,
    dataUrl: parsedDataUrl.dataUrl,
    base64Data: parsedDataUrl.base64Data
  };
}

function parseChatFormatContentValue(value: unknown): ParsedChatFormatImage[] {
  if (typeof value === "string") {
    return parseChatFormatImageOutputs(value);
  }

  if (!Array.isArray(value)) {
    const structuredImage = parseChatFormatStructuredImage(value);
    return structuredImage ? [structuredImage] : [];
  }

  const images: ParsedChatFormatImage[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      images.push(...parseChatFormatImageOutputs(item));
      continue;
    }

    if (!isProviderRecord(item)) {
      continue;
    }

    if (typeof item.text === "string") {
      images.push(...parseChatFormatImageOutputs(item.text));
      continue;
    }

    const structuredImage = parseChatFormatStructuredImage(item);
    if (structuredImage) {
      images.push(structuredImage);
    }
  }

  return images;
}

export function parseChatFormatImageResponseOutputs(
  payload: unknown
): ParsedChatFormatImage[] {
  if (typeof payload === "string") {
    return parseChatFormatImageOutputs(payload);
  }

  if (!isProviderRecord(payload)) {
    return [];
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  if (choices.length > 0) {
    return choices.flatMap((choice) => {
      if (!isProviderRecord(choice)) {
        return [];
      }

      const message = isProviderRecord(choice.message) ? choice.message : null;
      return parseChatFormatContentValue(
        message?.content ?? choice.content
      );
    });
  }

  return parseChatFormatContentValue(payload.content);
}

function toOpenAIChatMessages(
  messages: ChatMessage[]
): ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return { role: "assistant", content: message.content };
    }
    if (message.role === "system") {
      return { role: "system", content: message.content };
    }
    return { role: "user", content: message.content };
  });
}

function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessageParam[] {
  return messages
    .filter(
      (message): message is ChatMessage & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant"
    )
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}

function toAnthropicSystemPrompt(messages: ChatMessage[]): string {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0)
    .join("\n\n");
}

function normalizeOpenAIChatCompletion(
  response: unknown,
  fallbackModel: string
): ChatCompletionResponse {
  if (!isProviderRecord(response) || !Array.isArray(response.choices)) {
    throw new AIProviderResponseFormatError();
  }

  const choice = response.choices[0];
  const message = isProviderRecord(choice) && isProviderRecord(choice.message)
    ? choice.message
    : undefined;
  if (
    !message ||
    message.role !== "assistant" ||
    typeof message.content !== "string" ||
    message.content.length === 0
  ) {
    throw new AIProviderResponseFormatError();
  }

  const usage = isProviderRecord(response.usage)
    ? normalizeOpenAIUsage(response.usage)
    : undefined;
  return {
    content: message.content,
    model:
      typeof response.model === "string" && response.model.length > 0
        ? response.model
        : fallbackModel,
    ...(usage ? { usage } : {})
  };
}

function extractOpenAIStreamDelta(chunk: unknown): string {
  if (!isProviderRecord(chunk) || !Array.isArray(chunk.choices)) {
    throw new AIProviderResponseFormatError();
  }

  return chunk.choices
    .map((choice) => {
      if (!isProviderRecord(choice) || !isProviderRecord(choice.delta)) {
        throw new AIProviderResponseFormatError();
      }
      const content = choice.delta.content;
      if (content === undefined || content === null) {
        return "";
      }
      if (typeof content !== "string") {
        throw new AIProviderResponseFormatError();
      }
      return content;
    })
    .join("");
}

function normalizeAnthropicMessage(
  response: unknown,
  fallbackModel: string
): ChatCompletionResponse {
  if (!isProviderRecord(response) || !Array.isArray(response.content)) {
    throw new AIProviderResponseFormatError();
  }

  const content = response.content
    .filter((item): item is Record<string, unknown> => isProviderRecord(item))
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("");
  if (!content) {
    throw new AIProviderResponseFormatError();
  }

  const usage = isProviderRecord(response.usage)
    ? normalizeAnthropicUsage(response.usage)
    : undefined;
  return {
    content,
    model:
      typeof response.model === "string" && response.model.length > 0
        ? response.model
        : fallbackModel,
    ...(usage ? { usage } : {})
  };
}

function extractAnthropicStreamDelta(event: unknown): string {
  if (!isProviderRecord(event) || event.type !== "content_block_delta") {
    return "";
  }
  if (!isProviderRecord(event.delta)) {
    throw new AIProviderResponseFormatError();
  }
  if (event.delta.type !== "text_delta") {
    return "";
  }
  if (typeof event.delta.text !== "string") {
    throw new AIProviderResponseFormatError();
  }
  return event.delta.text;
}

export function createOpenAICompatibleAdapter(
  config: OpenAICompatibleAdapterConfig
): ChatCompletionAdapter & ImageGenerationAdapter & StreamingChatCompletionAdapter {
  const fetcher = config.fetchImpl ?? fetch;
  let client: OpenAI | undefined;

  const getClient = (): OpenAI => {
    assertProviderConfig(config);
    joinProviderEndpointUrl(config.baseUrl, "/images/generations");
    const ambientHeaderNames = readAmbientOpenAICustomHeaderNames();
    const safeCustomHeaders = normalizeProviderHeaders(config.headersJson);
    client ??= new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      organization: null,
      project: null,
      adminAPIKey: null,
      webhookSecret: null,
      logLevel: "off",
      defaultHeaders: Object.fromEntries(
        [...ambientHeaderNames].map((name) => [name, null])
      ),
      fetch: async (input, init) => {
        const response = await fetcher(input, {
          ...init,
          headers: toProviderFetchHeaders(
            init?.headers,
            ambientHeaderNames,
            safeCustomHeaders,
            config.apiKey,
            init?.body
          )
        });
        return normalizeSdkJsonResponseContentType(response);
      },
      maxRetries: 0
    });
    return client;
  };

  return {
    async createChatCompletion(request) {
      assertProviderConfig(config);
      const endpointPath = "/chat/completions";
      const model = request.model.trim() || config.defaultModel.trim();
      const requestedMaxTokens = request.maxTokens;

      if (!model) {
        throw new Error("DEFAULT_MODEL is required");
      }

      try {
        const response = await getClient().chat.completions.create(
          {
            model,
            messages: toOpenAIChatMessages(request.messages),
            temperature: request.temperature ?? 0.7,
            ...(typeof requestedMaxTokens === "number" &&
            Number.isSafeInteger(requestedMaxTokens) &&
            requestedMaxTokens > 0
              ? { max_tokens: requestedMaxTokens }
              : {})
          },
          {
            maxRetries: 0,
            signal: request.signal,
            ...(isValidPositiveTimeoutMs(config.timeoutMs)
              ? { timeout: config.timeoutMs }
              : {})
          }
        );
        return normalizeOpenAIChatCompletion(response, model);
      } catch (error) {
        normalizeSdkChatTransportError(error, request.signal, endpointPath);
      }
    },

    async createStreamingChatCompletion(request) {
      assertProviderConfig(config);

      const endpointPath = "/chat/completions";
      const model = request.model.trim() || config.defaultModel.trim();

      if (!model) {
        throw new Error("DEFAULT_MODEL is required");
      }

      let content = "";
      let streamController: AbortController | undefined;
      try {
        const stream = await getClient().chat.completions.create(
          {
            model,
            messages: toOpenAIChatMessages(request.messages),
            temperature: request.temperature ?? 0.7,
            stream: true
          },
          {
            maxRetries: 0,
            signal: request.signal,
            ...(isValidPositiveTimeoutMs(config.timeoutMs)
              ? { timeout: config.timeoutMs }
              : {})
          }
        );
        streamController = stream.controller;
        for await (const chunk of stream) {
          const delta = extractOpenAIStreamDelta(chunk);
          if (!delta) {
            continue;
          }
          content += delta;
          await notifyPlatformStreamDelta(request.onDelta, delta);
        }
        if (request.signal?.aborted) {
          throw new AIProviderAbortError();
        }
      } catch (error) {
        streamController?.abort();
        normalizeSdkChatTransportError(error, request.signal, endpointPath);
      }

      if (!content) {
        throw new AIProviderResponseFormatError();
      }

      return {
        content,
        model
      };
    },

    async createImageGeneration(request) {
      const model = request.model.trim() || config.defaultModel.trim();
      const referenceImages = request.referenceImages ?? [];
      const endpointPath = referenceImages.length > 0
        ? "/images/edits"
        : "/images/generations";

      if (!model) {
        throw new Error("DEFAULT_MODEL is required");
      }

      try {
        const client = getClient();
        const imageResponseFormat = config.imageResponseFormat ?? "url";
        const requestOptions = {
          maxRetries: 0 as const,
          signal: request.signal,
          ...(isValidPositiveTimeoutMs(config.timeoutMs)
            ? { timeout: config.timeoutMs }
            : {})
        };
        const response = referenceImages.length > 0
          ? await client.images.edit(
              {
                image:
                  referenceImages.length === 1
                    ? await toOpenAIImageUpload(referenceImages[0]!)
                    : await Promise.all(
                        referenceImages.map(toOpenAIImageUpload)
                      ),
                model,
                prompt: request.prompt,
                size: request.size,
                n: request.count,
                response_format: imageResponseFormat
              },
              requestOptions
            )
          : await client.images.generate(
              {
                model,
                prompt: request.prompt,
                size: request.size,
                n: request.count,
                response_format: imageResponseFormat
              },
              {
                ...requestOptions,
                headers: {
                  Authorization: `Bearer ${config.apiKey}`,
                  "Content-Type": "application/json"
                }
              }
            );

        return {
          images: parseProviderImageOutputs(
            response,
            imageResponseFormat,
            false,
            request.count
          )
        };
      } catch (error) {
        normalizeOpenAIImageError(
          error,
          request.signal,
          endpointPath,
          referenceImages.length > 0
        );
      }
    }
  };
}

export function createAnthropicChatAdapter(
  config: AnthropicChatAdapterConfig
): ChatCompletionAdapter & StreamingChatCompletionAdapter {
  const fetcher = config.fetchImpl ?? fetch;
  let client: Anthropic | undefined;

  const getClient = (): Anthropic => {
    assertProviderConfig(config);
    const baseURL = normalizeAnthropicSdkBaseUrl(config.baseUrl);
    try {
      joinProviderEndpointUrl(baseURL, "/v1/messages");
    } catch {
      throw new AIProviderRequestError("AI provider request failed", {
        endpointPath: "/v1/messages"
      });
    }
    const ambientHeaderNames = readAmbientAnthropicCustomHeaderNames();
    const safeCustomHeaders = normalizeProviderHeaders(config.headersJson);
    client ??= new Anthropic({
      apiKey: config.apiKey,
      authToken: null,
      webhookKey: null,
      baseURL,
      logLevel: "off",
      defaultHeaders: Object.fromEntries(
        [...ambientHeaderNames].map((name) => [name, null])
      ),
      fetch: async (input, init) => {
        const response = await fetcher(input, {
          ...init,
          headers: toAnthropicProviderFetchHeaders(
            init?.headers,
            ambientHeaderNames,
            safeCustomHeaders,
            config.apiKey
          )
        });
        return normalizeSdkJsonResponseContentType(response);
      },
      maxRetries: 0
    });
    return client;
  };

  return {
    async createChatCompletion(request) {
      assertProviderConfig(config);

      const model = request.model.trim() || config.defaultModel.trim();

      if (!model) {
        throw new Error("DEFAULT_MODEL is required");
      }

      const messages = toAnthropicMessages(request.messages);
      const system = toAnthropicSystemPrompt(request.messages);
      const maxTokens = resolveAnthropicMaxTokens(
        request.maxTokens,
        config.maxTokens
      );

      try {
        const response = await getClient().messages.create(
          {
            model,
            max_tokens: maxTokens,
            ...(system ? { system } : {}),
            messages,
            ...(typeof request.temperature === "number"
              ? { temperature: request.temperature }
              : {})
          },
          {
            maxRetries: 0,
            signal: request.signal,
            ...(isValidPositiveTimeoutMs(config.timeoutMs)
              ? { timeout: config.timeoutMs }
              : {})
          }
        );
        return normalizeAnthropicMessage(response, model);
      } catch (error) {
        normalizeSdkChatTransportError(error, request.signal, "/v1/messages");
      }
    },

    async createStreamingChatCompletion(request) {
      assertProviderConfig(config);

      const model = request.model.trim() || config.defaultModel.trim();

      if (!model) {
        throw new Error("DEFAULT_MODEL is required");
      }

      const messages = toAnthropicMessages(request.messages);
      const system = toAnthropicSystemPrompt(request.messages);
      const maxTokens = resolveAnthropicMaxTokens(
        request.maxTokens,
        config.maxTokens
      );

      let content = "";
      let streamController: AbortController | undefined;
      try {
        const stream = await getClient().messages.create(
          {
            model,
            max_tokens: maxTokens,
            ...(system ? { system } : {}),
            messages,
            ...(typeof request.temperature === "number"
              ? { temperature: request.temperature }
              : {}),
            stream: true
          },
          {
            maxRetries: 0,
            signal: request.signal,
            ...(isValidPositiveTimeoutMs(config.timeoutMs)
              ? { timeout: config.timeoutMs }
              : {})
          }
        );
        streamController = stream.controller;
        for await (const event of stream) {
          const delta = extractAnthropicStreamDelta(event);
          if (!delta) {
            continue;
          }
          content += delta;
          await notifyPlatformStreamDelta(request.onDelta, delta);
        }
        if (request.signal?.aborted) {
          throw new AIProviderAbortError();
        }
      } catch (error) {
        streamController?.abort();
        normalizeSdkChatTransportError(error, request.signal, "/v1/messages");
      }

      if (!content) {
        throw new AIProviderResponseFormatError();
      }

      return {
        content,
        model
      };
    }
  };
}

function normalizeAnthropicSdkBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/u, "");
}

function resolveAnthropicMaxTokens(
  requestedMaxTokens: number | undefined,
  configuredMaxTokens: number | undefined
): number {
  const requested =
    typeof requestedMaxTokens === "number" &&
    Number.isInteger(requestedMaxTokens) &&
    requestedMaxTokens > 0
      ? requestedMaxTokens
      : undefined;
  const configured =
    Number.isInteger(configuredMaxTokens) && Number(configuredMaxTokens) > 0
      ? Number(configuredMaxTokens)
      : undefined;

  if (requested !== undefined && configured !== undefined) {
    return Math.min(requested, configured);
  }

  return requested ?? configured ?? 4096;
}

const AGNES_BATCH_TIMEOUT_MAX_MS = 4 * 60 * 1000;

function isValidAgnesTimeoutMs(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

async function runAgnesRequestWithTimeout<T>({
  operation,
  parentSignal,
  timeoutMs
}: {
  operation: (signal: AbortSignal | undefined) => Promise<T>;
  parentSignal?: AbortSignal;
  timeoutMs?: number;
}): Promise<T> {
  if (
    !isValidAgnesTimeoutMs(timeoutMs)
  ) {
    return operation(parentSignal);
  }

  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const abortFromParent = () => controller.abort();

  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  const operationPromise = Promise.resolve().then(() =>
    operation(controller.signal)
  );
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new AIProviderTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      await operationPromise.catch(() => undefined);
      throw new AIProviderTimeoutError();
    }
    throw error;
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

const AGNES_IMAGE_ENDPOINT = "/v1/images/generations";

function throwIfAgnesPlatformError(error: unknown): void {
  if (
    error instanceof AIProviderTimeoutError ||
    error instanceof AIProviderAbortError ||
    error instanceof AIProviderRequestError ||
    error instanceof AIProviderResponseFormatError
  ) {
    throw error;
  }
}

function normalizeAgnesRequestError(
  error: unknown,
  signal: AbortSignal | undefined,
  statusCode?: number
): never {
  throwIfAgnesPlatformError(error);

  if (signal?.aborted || isAbortError(error)) {
    throw new AIProviderAbortError();
  }

  throw new AIProviderRequestError("AI provider request failed", {
    statusCode,
    endpointPath: AGNES_IMAGE_ENDPOINT
  });
}

function normalizeAgnesResponseError(
  error: unknown,
  signal: AbortSignal | undefined
): never {
  throwIfAgnesPlatformError(error);

  if (signal?.aborted || isAbortError(error)) {
    throw new AIProviderAbortError();
  }

  throw new AIProviderResponseFormatError();
}

export function createAgnesImageAdapter(
  config: OpenAICompatibleAdapterConfig
): ImageGenerationAdapter {
  const fetcher = config.fetchImpl ?? fetch;

  return {
    async createImageGeneration(request) {
      assertProviderConfig(config);

      const referenceImages = request.referenceImages ?? [];
      if (referenceImages.length > 1) {
        throw new AIProviderResponseFormatError();
      }

      const baseUrl = config.baseUrl.replace(/\/+$/, "");
      const model = request.model.trim() || config.defaultModel.trim();

      if (!model) {
        throw new Error("DEFAULT_MODEL is required");
      }

      const images: GeneratedImageOutput[] = [];
      const batchStartedAt = Date.now();
      const perRequestTimeoutMs = isValidAgnesTimeoutMs(config.timeoutMs)
        ? config.timeoutMs
        : undefined;
      const batchTimeoutMs =
        request.count === 1
          ? undefined
          : isValidAgnesTimeoutMs(config.batchTimeoutMs)
            ? Math.min(config.batchTimeoutMs, AGNES_BATCH_TIMEOUT_MAX_MS)
            : perRequestTimeoutMs === undefined
              ? undefined
              : Math.min(
                  perRequestTimeoutMs * request.count,
                  AGNES_BATCH_TIMEOUT_MAX_MS
                );
      const batchDeadlineAt =
        batchTimeoutMs === undefined
          ? undefined
          : batchStartedAt + batchTimeoutMs;

      for (let candidateIndex = 0; candidateIndex < request.count; candidateIndex += 1) {
        const remainingBatchMs =
          batchDeadlineAt === undefined
            ? undefined
            : batchDeadlineAt - Date.now();

        if (remainingBatchMs !== undefined && remainingBatchMs <= 0) {
          if (images.length > 0) {
            break;
          }
          throw new AIProviderTimeoutError();
        }

        const effectivePrompt = buildAgnesEffectivePrompt(
          request.prompt,
          candidateIndex
        );
        const candidateTimeoutMs =
          remainingBatchMs === undefined
            ? perRequestTimeoutMs
            : perRequestTimeoutMs === undefined
              ? remainingBatchMs
              : Math.min(perRequestTimeoutMs, remainingBatchMs);

        let candidateImage: GeneratedImageOutput;
        try {
          candidateImage = await runAgnesRequestWithTimeout({
            parentSignal: request.signal,
            timeoutMs: candidateTimeoutMs,
            operation: async (signal) => {
              let response: Response;
              try {
                response = await fetcher(
                  `${baseUrl}${AGNES_IMAGE_ENDPOINT}`,
                  {
                    method: "POST",
                    headers: {
                      ...normalizeProviderHeaders(config.headersJson),
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${config.apiKey}`
                    },
                    body: JSON.stringify({
                      model,
                      prompt: effectivePrompt,
                      size: request.size,
                      extra_body: {
                        ...(referenceImages[0]
                          ? { image: [referenceImages[0].dataUrl] }
                          : {}),
                        response_format: "url"
                      }
                    }),
                    signal
                  }
                );
              } catch (error) {
                normalizeAgnesRequestError(error, signal);
              }

              if (!response.ok) {
                try {
                  await response.text();
                } catch (error) {
                  normalizeAgnesRequestError(error, signal, response.status);
                }
                throw createProviderHttpError(response.status, AGNES_IMAGE_ENDPOINT);
              }

              let payload: unknown;
              try {
                payload = await response.json();
              } catch (error) {
                normalizeAgnesResponseError(error, signal);
              }
              const candidateImages = parseProviderImageOutputs(
                payload,
                "b64_json",
                true,
                1
              );
              const firstImage = candidateImages[0];

              if (!firstImage) {
                throw new AIProviderResponseFormatError();
              }

              return firstImage;
            }
          });
        } catch (error) {
          if (error instanceof AIProviderAbortError) {
            throw error;
          }
          if (images.length > 0) {
            break;
          }
          throw error;
        }

        images.push(candidateImage);
      }

      return {
        images
      };
    }
  };
}

function buildAgnesEffectivePrompt(prompt: string, candidateIndex: number): string {
  if (candidateIndex === 0) {
    return prompt;
  }

  const directive =
    candidateIndex === 1
      ? "[Batch variation 2: Create a clearly distinct alternative under the same request. Preserve every explicit subject, identity, product, text, brand, style, color, scene, size, and composition constraint. Vary only details that the user did not explicitly fix, such as framing, camera angle, pose, lighting details, or background arrangement.]"
      : candidateIndex === 2
        ? "[Batch variation 3: Create another independent candidate under the same request. Preserve every explicit constraint. Prefer a different treatment of unspecified framing, shot distance, subject placement, pose, or environmental detail, without changing the requested visual style.]"
        : "[Batch variation 4: Create another visibly distinct candidate under the same request. Preserve every explicit constraint. Vary only unspecified composition, viewpoint, pose, lighting balance, or background layout. Do not change the requested subject or style.]";

  return `${prompt}\n\n${directive}`;
}

function assertProviderConfig(config: OpenAICompatibleAdapterConfig) {
  if (!config.apiKey.trim()) {
    throw new Error("AI_API_KEY is required");
  }

  if (!config.baseUrl.trim()) {
    throw new Error("AI_BASE_URL is required");
  }
}

function normalizeOpenAIUsage(
  usage: Record<string, unknown>
): ChatCompletionUsage | undefined {
  return {
    ...(typeof usage.prompt_tokens === "number"
      ? { promptTokens: usage.prompt_tokens }
      : {}),
    ...(typeof usage.completion_tokens === "number"
      ? { completionTokens: usage.completion_tokens }
      : {}),
    ...(typeof usage.total_tokens === "number"
      ? { totalTokens: usage.total_tokens }
      : {})
  };
}

function normalizeAnthropicUsage(
  usage: Record<string, unknown>
): ChatCompletionUsage | undefined {
  const promptTokens =
    typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const completionTokens =
    typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;

  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(promptTokens !== undefined && completionTokens !== undefined
      ? { totalTokens: promptTokens + completionTokens }
      : {})
  };
}

export * from "./video";
