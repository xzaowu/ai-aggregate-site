import {
  buildImageGenerationAttemptHeaders,
  classifyImageGenerationHttpResponse,
  classifyImageGenerationTransportError,
  type ImageGenerationAttempt,
  type ImageGenerationAttemptDecision,
  type GenericImageGenerationRequestPayload
} from "./image-generation-attempt";

export type ImageGenerationRequestResult = Readonly<{
  status: number | null;
  body: unknown;
  decision: ImageGenerationAttemptDecision;
}>;

export type SendImageGenerationAttemptOptions = Readonly<{
  attempt: ImageGenerationAttempt<GenericImageGenerationRequestPayload>;
  token: string;
  endpoint: string;
  fetchImplementation: typeof fetch;
  signal?: AbortSignal;
  onFetchStarted?: () => void;
}>;

export async function sendImageGenerationAttempt({
  attempt,
  token,
  endpoint,
  fetchImplementation,
  signal,
  onFetchStarted
}: SendImageGenerationAttemptOptions): Promise<ImageGenerationRequestResult> {
  let response: Response;

  try {
    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...buildImageGenerationAttemptHeaders(attempt)
      },
      body: JSON.stringify(attempt.payload),
      ...(signal ? { signal } : {})
    };
    onFetchStarted?.();
    response = await fetchImplementation(endpoint, requestInit);
  } catch {
    return {
      status: null,
      body: null,
      decision: classifyImageGenerationTransportError()
    };
  }

  let body: unknown = null;

  try {
    body = await response.json();
  } catch {
    // Malformed or non-JSON responses stay opaque and are classified as unknown.
  }

  return {
    status: response.status,
    body,
    decision: classifyImageGenerationHttpResponse(response.status, body)
  };
}
