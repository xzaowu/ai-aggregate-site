import { createHash } from "node:crypto";
import { NODATA, NOTFOUND, Resolver, TIMEOUT } from "node:dns/promises";
import * as https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import {
  isPublicRemoteAddress,
  validateRemoteImageDownloadUrl,
  type RemoteImageAllowedHostRule
} from "./remote-image-url-policy";

const DNS_QUERY_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 10_000;
const HEADERS_TIMEOUT_MS = 15_000;
const ESTABLISHMENT_TIMEOUT_MS = 30_000;
const MAX_RESOLVED_ADDRESSES = 32;
const MAX_REDIRECTS = 3;
const MAX_HEADER_SIZE = 16 * 1024;

export type RemoteImageFetcherErrorCode =
  | "REMOTE_IMAGE_DNS_FAILED"
  | "REMOTE_IMAGE_DNS_TIMEOUT"
  | "REMOTE_IMAGE_ADDRESS_FORBIDDEN"
  | "REMOTE_IMAGE_ADDRESS_LIMIT"
  | "REMOTE_IMAGE_CONNECT_FAILED"
  | "REMOTE_IMAGE_CONNECT_TIMEOUT"
  | "REMOTE_IMAGE_HEADERS_TIMEOUT"
  | "REMOTE_IMAGE_REDIRECT_INVALID"
  | "REMOTE_IMAGE_REDIRECT_LIMIT"
  | "REMOTE_IMAGE_REDIRECT_LOOP"
  | "REMOTE_IMAGE_HTTP_STATUS"
  | "REMOTE_IMAGE_CONTENT_ENCODING_FORBIDDEN"
  | "REMOTE_IMAGE_TIMEOUT"
  | "REMOTE_IMAGE_ABORTED";

export type RemoteImageFetcherStage =
  | "dns"
  | "connect"
  | "headers"
  | "redirect"
  | "overall"
  | "request";

const remoteImageFetcherMessages: Record<RemoteImageFetcherErrorCode, string> = {
  REMOTE_IMAGE_DNS_FAILED: "remote image DNS resolution failed",
  REMOTE_IMAGE_DNS_TIMEOUT: "remote image DNS resolution timed out",
  REMOTE_IMAGE_ADDRESS_FORBIDDEN: "remote image address is not public",
  REMOTE_IMAGE_ADDRESS_LIMIT: "remote image address limit exceeded",
  REMOTE_IMAGE_CONNECT_FAILED: "remote image connection failed",
  REMOTE_IMAGE_CONNECT_TIMEOUT: "remote image connection timed out",
  REMOTE_IMAGE_HEADERS_TIMEOUT: "remote image response headers timed out",
  REMOTE_IMAGE_REDIRECT_INVALID: "remote image redirect is invalid",
  REMOTE_IMAGE_REDIRECT_LIMIT: "remote image redirect limit exceeded",
  REMOTE_IMAGE_REDIRECT_LOOP: "remote image redirect loop detected",
  REMOTE_IMAGE_HTTP_STATUS: "remote image response status is not allowed",
  REMOTE_IMAGE_CONTENT_ENCODING_FORBIDDEN: "remote image response content encoding is not allowed",
  REMOTE_IMAGE_TIMEOUT: "remote image request timed out",
  REMOTE_IMAGE_ABORTED: "remote image request was aborted"
};

export class RemoteImageFetcherError extends Error {
  readonly code: RemoteImageFetcherErrorCode;
  readonly stage: RemoteImageFetcherStage;
  readonly status?: number;
  readonly redirectCount?: number;

  constructor(
    code: RemoteImageFetcherErrorCode,
    stage: RemoteImageFetcherStage,
    metadata: {
      status?: number;
      redirectCount?: number;
    } = {}
  ) {
    super(remoteImageFetcherMessages[code]);
    this.name = "RemoteImageFetcherError";
    this.code = code;
    this.stage = stage;
    const status = safeHttpStatus(metadata.status);
    if (status !== undefined) {
      this.status = status;
    }
    const redirectCount = safeNonNegativeInteger(metadata.redirectCount);
    if (redirectCount !== undefined) {
      this.redirectCount = redirectCount;
    }
  }
}

export interface RemoteImageFetchInput {
  url: string;
  allowedHosts: readonly RemoteImageAllowedHostRule[];
  signal?: AbortSignal;
}

export interface RemoteImageFetchResult {
  stream: Readable;
  contentType: string | null;
  contentLength: number | null;
  finalHostname: string;
  redirectCount: number;
  sourceUrlHash: string;
  cancel(): void;
}

export interface RemoteImageResponse extends Readable {
  readonly statusCode?: number;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  destroy(error?: Error): this;
}

export interface RemoteImageDnsResolver {
  resolve4(hostname: string): Promise<readonly string[]>;
  resolve6(hostname: string): Promise<readonly string[]>;
  cancel(): void;
}

export interface RemoteImageSocket {
  destroy(error?: Error): unknown;
  once(event: "secureConnect", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
}

export interface RemoteImageRequest {
  end(): void;
  destroy(error?: Error): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "socket", listener: (socket: RemoteImageSocket) => void): unknown;
}

export interface RemoteImageRequestOptions extends https.RequestOptions {
  autoSelectFamily: false;
}

export type RemoteImageRequestImplementation = (
  options: RemoteImageRequestOptions,
  callback: (response: RemoteImageResponse) => void
) => RemoteImageRequest;

export interface RemoteImageTimer {
  cancel(): void;
}

export interface RemoteImageTimerScheduler {
  schedule(callback: () => void, delayMs: number): RemoteImageTimer;
}

export interface RemoteImageFetcherDependencies {
  createResolver?(options: { timeout: number; tries: number }): RemoteImageDnsResolver;
  requestImpl?: RemoteImageRequestImplementation;
  now?(): number;
  timerScheduler?: RemoteImageTimerScheduler;
}

export interface RemoteImageFetcher {
  fetchRemoteImage(input: RemoteImageFetchInput): Promise<RemoteImageFetchResult>;
}

interface ResolvedRemoteAddress {
  address: string;
  family: 4 | 6;
}

interface FetcherRuntimeDependencies {
  createResolver(options: { timeout: number; tries: number }): RemoteImageDnsResolver;
  requestImpl: RemoteImageRequestImplementation;
  now(): number;
  timerScheduler: RemoteImageTimerScheduler;
}

const defaultTimerScheduler: RemoteImageTimerScheduler = {
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return {
      cancel() {
        clearTimeout(timer);
      }
    };
  }
};

export function createRemoteImageFetcher(
  dependencies: RemoteImageFetcherDependencies = {}
): RemoteImageFetcher {
  const runtime: FetcherRuntimeDependencies = {
    createResolver:
      dependencies.createResolver ??
      (() =>
        new Resolver({
          timeout: DNS_QUERY_TIMEOUT_MS,
          tries: 1
        })),
    requestImpl:
      dependencies.requestImpl ??
      ((options, callback) => https.request(options, callback)),
    now: dependencies.now ?? (() => Date.now()),
    timerScheduler: dependencies.timerScheduler ?? defaultTimerScheduler
  };

  return {
    async fetchRemoteImage(input) {
      if (input.signal?.aborted) {
        throw new RemoteImageFetcherError("REMOTE_IMAGE_ABORTED", "request");
      }

      const startedAt = runtime.now();
      const deadline = startedAt + ESTABLISHMENT_TIMEOUT_MS;
      const operationController = new AbortController();
      let operationError: RemoteImageFetcherError | null = null;

      const abortOperation = (error: RemoteImageFetcherError): void => {
        if (operationError !== null) {
          return;
        }

        operationError = error;
        operationController.abort();
      };

      const getOperationError = (): RemoteImageFetcherError =>
        operationError ?? new RemoteImageFetcherError("REMOTE_IMAGE_ABORTED", "request");

      const ensureRemainingTime = (): number => {
        if (operationError !== null) {
          throw operationError;
        }

        const remaining = deadline - runtime.now();
        if (remaining <= 0) {
          const error = new RemoteImageFetcherError("REMOTE_IMAGE_TIMEOUT", "overall");
          abortOperation(error);
          throw error;
        }

        return remaining;
      };

      const externalAbortListener = (): void => {
        abortOperation(new RemoteImageFetcherError("REMOTE_IMAGE_ABORTED", "request"));
      };
      input.signal?.addEventListener("abort", externalAbortListener, { once: true });

      const overallTimer = runtime.timerScheduler.schedule(() => {
        abortOperation(new RemoteImageFetcherError("REMOTE_IMAGE_TIMEOUT", "overall"));
      }, ESTABLISHMENT_TIMEOUT_MS);

      try {
        ensureRemainingTime();

        const initialUrl = validateRemoteImageDownloadUrl(input.url, input.allowedHosts);
        const sourceUrlHash = hashNormalizedUrl(initialUrl.url);
        const visitedUrlHashes = new Set<string>([sourceUrlHash]);
        let currentUrl = initialUrl.url;
        let currentHostname = initialUrl.hostname;
        let redirectCount = 0;

        for (;;) {
          const addresses = await resolveVerifiedAddresses({
            hostname: currentHostname,
            signal: operationController.signal,
            getOperationError,
            ensureRemainingTime,
            runtime
          });
          const selectedAddress = addresses[0];
          if (selectedAddress === undefined) {
            throw new RemoteImageFetcherError("REMOTE_IMAGE_DNS_FAILED", "dns");
          }

          const response = await requestLockedAddress({
            url: currentUrl,
            hostname: currentHostname,
            address: selectedAddress,
            signal: operationController.signal,
            getOperationError,
            ensureRemainingTime,
            runtime
          });
          ensureRemainingTime();

          if (isSupportedRedirectStatus(response.statusCode)) {
            const location = readSingleHeaderValue(response.headers.location);
            safeDestroy(response);

            if (redirectCount >= MAX_REDIRECTS) {
              throw new RemoteImageFetcherError(
                "REMOTE_IMAGE_REDIRECT_LIMIT",
                "redirect",
                { redirectCount }
              );
            }
            if (location === null) {
              throw new RemoteImageFetcherError("REMOTE_IMAGE_REDIRECT_INVALID", "redirect");
            }

            let redirectUrl: URL;
            try {
              redirectUrl = new URL(location, currentUrl);
            } catch {
              throw new RemoteImageFetcherError("REMOTE_IMAGE_REDIRECT_INVALID", "redirect");
            }

            let validatedRedirectUrl: ReturnType<typeof validateRemoteImageDownloadUrl>;
            try {
              validatedRedirectUrl = validateRemoteImageDownloadUrl(
                redirectUrl.href,
                input.allowedHosts
              );
            } catch {
              throw new RemoteImageFetcherError(
                "REMOTE_IMAGE_REDIRECT_INVALID",
                "redirect",
                { redirectCount }
              );
            }

            const redirectHash = hashNormalizedUrl(validatedRedirectUrl.url);
            if (visitedUrlHashes.has(redirectHash)) {
              throw new RemoteImageFetcherError(
                "REMOTE_IMAGE_REDIRECT_LOOP",
                "redirect",
                { redirectCount }
              );
            }

            visitedUrlHashes.add(redirectHash);
            redirectCount += 1;
            currentUrl = validatedRedirectUrl.url;
            currentHostname = validatedRedirectUrl.hostname;
            continue;
          }

          if (response.statusCode !== 200) {
            safeDestroy(response);
            throw new RemoteImageFetcherError("REMOTE_IMAGE_HTTP_STATUS", "headers", {
              status: response.statusCode,
              redirectCount
            });
          }

          if (!isAllowedContentEncoding(response.headers["content-encoding"])) {
            safeDestroy(response);
            throw new RemoteImageFetcherError(
              "REMOTE_IMAGE_CONTENT_ENCODING_FORBIDDEN",
              "headers"
            );
          }

          const result = createFetchResult({
            response,
            contentType: readContentType(response.headers["content-type"]),
            contentLength: readContentLength(response.headers["content-length"]),
            finalHostname: currentHostname,
            redirectCount,
            sourceUrlHash,
            externalSignal: input.signal
          });

          return result;
        }
      } finally {
        overallTimer.cancel();
        input.signal?.removeEventListener("abort", externalAbortListener);
      }
    }
  };
}

async function resolveVerifiedAddresses(input: {
  hostname: string;
  signal: AbortSignal;
  getOperationError(): RemoteImageFetcherError;
  ensureRemainingTime(): number;
  runtime: FetcherRuntimeDependencies;
}): Promise<readonly ResolvedRemoteAddress[]> {
  const resolver = input.runtime.createResolver({
    timeout: DNS_QUERY_TIMEOUT_MS,
    tries: 1
  });
  let interrupted = false;
  let rejectInterrupted: ((error: RemoteImageFetcherError) => void) | null = null;
  const interruption = new Promise<never>((_resolve, reject) => {
    rejectInterrupted = reject;
  });
  const interrupt = (error: RemoteImageFetcherError): void => {
    if (interrupted) {
      return;
    }

    interrupted = true;
    safeCancelResolver(resolver);
    rejectInterrupted?.(error);
  };
  const abortListener = (): void => {
    interrupt(input.getOperationError());
  };
  input.signal.addEventListener("abort", abortListener, { once: true });

  let dnsTimer: RemoteImageTimer | null = null;
  try {
    const remaining = input.ensureRemainingTime();
    dnsTimer = input.runtime.timerScheduler.schedule(() => {
      interrupt(new RemoteImageFetcherError("REMOTE_IMAGE_DNS_TIMEOUT", "dns"));
    }, Math.min(DNS_QUERY_TIMEOUT_MS, remaining));

    const ipv4 = resolveDnsFamily(() => resolver.resolve4(input.hostname));
    const ipv6 = resolveDnsFamily(() => resolver.resolve6(input.hostname));
    const [ipv4Addresses, ipv6Addresses] = await Promise.race([
      Promise.all([ipv4, ipv6]),
      interruption
    ]);

    const addresses = deduplicateResolvedAddresses(ipv4Addresses, ipv6Addresses);
    if (addresses.length === 0) {
      throw new RemoteImageFetcherError("REMOTE_IMAGE_DNS_FAILED", "dns");
    }
    if (addresses.length > MAX_RESOLVED_ADDRESSES) {
      throw new RemoteImageFetcherError("REMOTE_IMAGE_ADDRESS_LIMIT", "dns");
    }
    if (addresses.some((address) => isIP(address.address) !== address.family)) {
      throw new RemoteImageFetcherError("REMOTE_IMAGE_DNS_FAILED", "dns");
    }
    if (addresses.some((address) => !isPublicRemoteAddress(address.address))) {
      throw new RemoteImageFetcherError("REMOTE_IMAGE_ADDRESS_FORBIDDEN", "dns");
    }

    return addresses;
  } finally {
    dnsTimer?.cancel();
    input.signal.removeEventListener("abort", abortListener);
  }
}

async function resolveDnsFamily(
  resolve: () => Promise<readonly string[]>
): Promise<readonly string[]> {
  try {
    return await resolve();
  } catch (error) {
    const code = readErrorCode(error);
    if (code === NODATA || code === NOTFOUND) {
      return [];
    }
    if (code === TIMEOUT) {
      throw new RemoteImageFetcherError("REMOTE_IMAGE_DNS_TIMEOUT", "dns");
    }
    throw new RemoteImageFetcherError("REMOTE_IMAGE_DNS_FAILED", "dns");
  }
}

function deduplicateResolvedAddresses(
  ipv4Addresses: readonly string[],
  ipv6Addresses: readonly string[]
): ResolvedRemoteAddress[] {
  const addresses: ResolvedRemoteAddress[] = [];
  const seen = new Set<string>();

  for (const [family, familyAddresses] of [
    [4, ipv4Addresses],
    [6, ipv6Addresses]
  ] as const) {
    for (const address of familyAddresses) {
      const key = `${family}:${address}`;
      if (!seen.has(key)) {
        seen.add(key);
        addresses.push({ address, family });
      }
    }
  }

  return addresses;
}

async function requestLockedAddress(input: {
  url: URL;
  hostname: string;
  address: ResolvedRemoteAddress;
  signal: AbortSignal;
  getOperationError(): RemoteImageFetcherError;
  ensureRemainingTime(): number;
  runtime: FetcherRuntimeDependencies;
}): Promise<RemoteImageResponse> {
  const requestOptions: RemoteImageRequestOptions = {
    protocol: "https:",
    hostname: input.hostname,
    port: 443,
    method: "GET",
    path: `${input.url.pathname}${input.url.search}`,
    servername: input.hostname,
    rejectUnauthorized: true,
    agent: false,
    family: input.address.family,
    autoSelectFamily: false,
    lookup: createLockedLookup(input.address),
    signal: input.signal,
    maxHeaderSize: MAX_HEADER_SIZE,
    headers: {
      Accept: "image/png,image/jpeg,image/webp",
      "Accept-Encoding": "identity",
      "User-Agent": "AI-Aggregate-Asset-Fetcher/1.0"
    }
  };

  return new Promise<RemoteImageResponse>((resolve, reject) => {
    let settled = false;
    let request: RemoteImageRequest | null = null;
    let socket: RemoteImageSocket | null = null;
    let response: RemoteImageResponse | null = null;
    let connectTimer: RemoteImageTimer | null = null;
    let headersTimer: RemoteImageTimer | null = null;

    const clearTimers = (): void => {
      connectTimer?.cancel();
      headersTimer?.cancel();
      connectTimer = null;
      headersTimer = null;
    };
    const cleanup = (): void => {
      clearTimers();
      input.signal.removeEventListener("abort", abortListener);
    };
    const rejectOnce = (error: RemoteImageFetcherError): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };
    const resolveOnce = (nextResponse: RemoteImageResponse): void => {
      if (settled) {
        safeDestroy(nextResponse);
        return;
      }

      settled = true;
      headersTimer?.cancel();
      headersTimer = null;
      cleanup();
      resolve(nextResponse);
    };
    const destroyActiveResources = (error: RemoteImageFetcherError): void => {
      safeDestroy(request, error);
      safeDestroy(socket, error);
      safeDestroy(response, error);
    };
    const abortListener = (): void => {
      const error = input.getOperationError();
      destroyActiveResources(error);
      rejectOnce(error);
    };

    input.signal.addEventListener("abort", abortListener, { once: true });

    let remaining: number;
    try {
      remaining = input.ensureRemainingTime();
    } catch (error) {
      input.signal.removeEventListener("abort", abortListener);
      if (error instanceof RemoteImageFetcherError) {
        reject(error);
        return;
      }
      reject(new RemoteImageFetcherError("REMOTE_IMAGE_CONNECT_FAILED", "connect"));
      return;
    }

    connectTimer = input.runtime.timerScheduler.schedule(() => {
      const error = new RemoteImageFetcherError("REMOTE_IMAGE_CONNECT_TIMEOUT", "connect");
      destroyActiveResources(error);
      rejectOnce(error);
    }, Math.min(CONNECT_TIMEOUT_MS, remaining));
    headersTimer = input.runtime.timerScheduler.schedule(() => {
      const error = new RemoteImageFetcherError("REMOTE_IMAGE_HEADERS_TIMEOUT", "headers");
      destroyActiveResources(error);
      rejectOnce(error);
    }, Math.min(HEADERS_TIMEOUT_MS, remaining));

    try {
      request = input.runtime.requestImpl(requestOptions, (nextResponse) => {
        response = nextResponse;
        resolveOnce(nextResponse);
      });
      request.once("error", () => {
        rejectOnce(new RemoteImageFetcherError("REMOTE_IMAGE_CONNECT_FAILED", "connect"));
      });
      request.once("socket", (nextSocket) => {
        socket = nextSocket;
        nextSocket.once("secureConnect", () => {
          connectTimer?.cancel();
          connectTimer = null;
        });
        nextSocket.once("error", () => {
          rejectOnce(new RemoteImageFetcherError("REMOTE_IMAGE_CONNECT_FAILED", "connect"));
        });
      });
      request.end();
    } catch {
      rejectOnce(new RemoteImageFetcherError("REMOTE_IMAGE_CONNECT_FAILED", "connect"));
    }
  });
}

function createLockedLookup(address: ResolvedRemoteAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, [{ address: address.address, family: address.family }]);
      return;
    }

    callback(null, address.address, address.family);
  };
}

function createFetchResult(input: {
  response: RemoteImageResponse;
  contentType: string | null;
  contentLength: number | null;
  finalHostname: string;
  redirectCount: number;
  sourceUrlHash: string;
  externalSignal?: AbortSignal;
}): RemoteImageFetchResult {
  let cancelled = false;
  let listenerAttached = false;
  const releaseSignalListener = (): void => {
    if (!listenerAttached) {
      return;
    }

    input.externalSignal?.removeEventListener("abort", abortListener);
    listenerAttached = false;
  };
  const cancel = (): void => {
    if (cancelled) {
      return;
    }

    cancelled = true;
    releaseSignalListener();
    safeDestroy(input.response);
  };
  const abortListener = (): void => {
    cancel();
  };
  const complete = (): void => {
    releaseSignalListener();
  };

  if (input.externalSignal !== undefined) {
    input.externalSignal.addEventListener("abort", abortListener, { once: true });
    listenerAttached = true;
    if (input.externalSignal.aborted) {
      cancel();
    }
  }

  input.response.once("end", complete);
  input.response.once("close", complete);
  input.response.once("error", complete);

  return {
    stream: input.response,
    contentType: input.contentType,
    contentLength: input.contentLength,
    finalHostname: input.finalHostname,
    redirectCount: input.redirectCount,
    sourceUrlHash: input.sourceUrlHash,
    cancel
  };
}

function readSingleHeaderValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readContentType(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.includes(",") ||
    /[\r\n]/u.test(value)
  ) {
    return null;
  }

  return value;
}

function readContentLength(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isAllowedContentEncoding(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && value.trim().toLowerCase() === "identity")
  );
}

function isSupportedRedirectStatus(statusCode: number | undefined): boolean {
  return (
    statusCode === 301 ||
    statusCode === 302 ||
    statusCode === 303 ||
    statusCode === 307 ||
    statusCode === 308
  );
}

function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function safeHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function hashNormalizedUrl(url: URL): string {
  return createHash("sha256").update(url.href).digest("hex");
}

function safeCancelResolver(resolver: RemoteImageDnsResolver): void {
  try {
    resolver.cancel();
  } catch {
    // Resolver cancellation is best-effort and must not expose resolver failures.
  }
}

function safeDestroy(
  resource: { destroy(error?: Error): unknown } | null,
  error?: RemoteImageFetcherError
): void {
  if (resource === null) {
    return;
  }

  try {
    resource.destroy(error);
  } catch {
    // Destruction is best-effort and must not expose transport failures.
  }
}
