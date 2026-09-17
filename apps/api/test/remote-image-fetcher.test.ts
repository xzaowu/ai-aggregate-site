import { createHash } from "node:crypto";
import { NODATA, NOTFOUND, REFUSED, SERVFAIL, TIMEOUT } from "node:dns/promises";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  RemoteImageFetcherError,
  createRemoteImageFetcher,
  type RemoteImageDnsResolver,
  type RemoteImageRequest,
  type RemoteImageRequestImplementation,
  type RemoteImageResponse,
  type RemoteImageSocket,
  type RemoteImageTimer,
  type RemoteImageTimerScheduler
} from "../src/remote-image-fetcher";
import { parseRemoteImageAllowedHostRules } from "../src/remote-image-url-policy";

const allowedHosts = parseRemoteImageAllowedHostRules(
  "images.example.com,static.example.net,*.cdn.example.com"
);
const sourceUrl = "https://images.example.com/source.png?token=initial-secret";

type HeaderValue = string | readonly string[] | undefined;
type RequestOptions = Parameters<RemoteImageRequestImplementation>[0];
type RequestCallback = Parameters<RemoteImageRequestImplementation>[1];
type DnsOutcome = readonly string[] | Promise<readonly string[]> | DnsTestError;

class DnsTestError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("test DNS error");
    this.code = code;
  }
}

class FakeResolver implements RemoteImageDnsResolver {
  readonly resolve4Hostnames: string[] = [];
  readonly resolve6Hostnames: string[] = [];
  cancelCalls = 0;

  constructor(
    private readonly ipv4: DnsOutcome = ["1.1.1.1"],
    private readonly ipv6: DnsOutcome = []
  ) {}

  async resolve4(hostname: string): Promise<readonly string[]> {
    this.resolve4Hostnames.push(hostname);
    return resolveDnsOutcome(this.ipv4);
  }

  async resolve6(hostname: string): Promise<readonly string[]> {
    this.resolve6Hostnames.push(hostname);
    return resolveDnsOutcome(this.ipv6);
  }

  cancel(): void {
    this.cancelCalls += 1;
  }
}

class FakeSocket extends EventEmitter implements RemoteImageSocket {
  destroyCalls = 0;
  destroyError: Error | undefined;

  destroy(error?: Error): this {
    this.destroyCalls += 1;
    this.destroyError = error;
    return this;
  }
}

class FakeRequest extends EventEmitter implements RemoteImageRequest {
  endCalls = 0;
  destroyCalls = 0;
  destroyError: Error | undefined;

  constructor(private readonly onEnd: () => void) {
    super();
  }

  end(): void {
    this.endCalls += 1;
    if (this.endCalls === 1) {
      this.onEnd();
    }
  }

  destroy(error?: Error): this {
    this.destroyCalls += 1;
    this.destroyError = error;
    return this;
  }
}

class FakeResponse extends PassThrough implements RemoteImageResponse {
  destroyCalls = 0;
  destroyError: Error | undefined;
  readonly headers: Readonly<Record<string, HeaderValue>>;
  readonly statusCode?: number;

  constructor(statusCode: number | undefined, headers: Record<string, HeaderValue> = {}) {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
  }

  override destroy(error?: Error): this {
    this.destroyCalls += 1;
    this.destroyError = error;
    return super.destroy(error);
  }
}

interface RequestStep {
  response?: FakeResponse;
  socket?: FakeSocket;
  requestError?: Error;
  socketError?: Error;
}

class FakeTimer implements RemoteImageTimer {
  cancelled = false;
  fired = false;

  constructor(
    readonly callback: () => void,
    readonly delayMs: number
  ) {}

  cancel(): void {
    this.cancelled = true;
  }

  fire(): void {
    if (this.cancelled || this.fired) {
      return;
    }

    this.fired = true;
    this.callback();
  }
}

class FakeTimerScheduler implements RemoteImageTimerScheduler {
  readonly timers: FakeTimer[] = [];

  schedule(callback: () => void, delayMs: number): RemoteImageTimer {
    const timer = new FakeTimer(callback, delayMs);
    this.timers.push(timer);
    return timer;
  }

  fire(delayMs: number): void {
    const timer = this.timers.find(
      (candidate) => candidate.delayMs === delayMs && !candidate.cancelled && !candidate.fired
    );
    if (timer === undefined) {
      throw new Error("expected active timer");
    }

    timer.fire();
  }

  activeTimers(): readonly FakeTimer[] {
    return this.timers.filter((timer) => !timer.cancelled && !timer.fired);
  }
}

class Deferred<T> {
  readonly promise: Promise<T>;
  private resolvePromise: ((value: T) => void) | null = null;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  resolve(value: T): void {
    const resolvePromise = this.resolvePromise;
    if (resolvePromise === null) {
      throw new Error("deferred promise was already resolved");
    }

    this.resolvePromise = null;
    resolvePromise(value);
  }
}

class FetchHarness {
  readonly scheduler = new FakeTimerScheduler();
  readonly resolverOptions: Array<{ timeout: number; tries: number }> = [];
  readonly capturedOptions: RequestOptions[] = [];
  readonly requests: FakeRequest[] = [];
  readonly createdResolvers: FakeResolver[] = [];

  constructor(
    private readonly resolvers: FakeResolver[],
    private readonly steps: RequestStep[]
  ) {}

  createFetcher() {
    return createRemoteImageFetcher({
      createResolver: (options) => {
        this.resolverOptions.push(options);
        const resolver = this.resolvers.shift();
        if (resolver === undefined) {
          throw new Error("unexpected DNS resolver creation");
        }
        this.createdResolvers.push(resolver);
        return resolver;
      },
      requestImpl: (options, callback) => this.request(options, callback),
      now: () => 0,
      timerScheduler: this.scheduler
    });
  }

  private request(options: RequestOptions, callback: RequestCallback): RemoteImageRequest {
    const step = this.steps.shift();
    if (step === undefined) {
      throw new Error("unexpected HTTPS request");
    }

    const request = new FakeRequest(() => {
      queueMicrotask(() => {
        if (step.socket !== undefined) {
          request.emit("socket", step.socket);
          step.socket.emit("secureConnect");
          if (step.socketError !== undefined) {
            step.socket.emit("error", step.socketError);
          }
        }
        if (step.requestError !== undefined) {
          request.emit("error", step.requestError);
        }
        if (step.response !== undefined) {
          callback(step.response);
        }
      });
    });
    this.capturedOptions.push(options);
    this.requests.push(request);
    return request;
  }
}

function resolveDnsOutcome(outcome: DnsOutcome): Promise<readonly string[]> {
  if (outcome instanceof DnsTestError) {
    return Promise.reject(outcome);
  }

  return Promise.resolve(outcome);
}

function response(
  statusCode: number | undefined,
  headers: Record<string, HeaderValue> = {}
): FakeResponse {
  return new FakeResponse(statusCode, headers);
}

function publicResolver(
  ipv4: readonly string[] = ["1.1.1.1"],
  ipv6: readonly string[] = []
): FakeResolver {
  return new FakeResolver(ipv4, ipv6);
}

function createSuccessHarness(
  responseHeaders: Record<string, HeaderValue> = {},
  resolver = publicResolver()
): { harness: FetchHarness; response: FakeResponse } {
  const finalResponse = response(200, responseHeaders);
  return {
    harness: new FetchHarness([resolver], [{ response: finalResponse }]),
    response: finalResponse
  };
}

async function fetchFrom(
  harness: FetchHarness,
  input: Partial<{ url: string; signal: AbortSignal }> = {}
) {
  return harness.createFetcher().fetchRemoteImage({
    url: input.url ?? sourceUrl,
    allowedHosts,
    signal: input.signal
  });
}

async function captureFetcherError(promise: Promise<unknown>): Promise<RemoteImageFetcherError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteImageFetcherError);
    if (error instanceof RemoteImageFetcherError) {
      return error;
    }
  }

  throw new Error("expected RemoteImageFetcherError");
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForRequests(harness: FetchHarness, expectedCount: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (harness.requests.length >= expectedCount) {
      return;
    }
    await Promise.resolve();
  }

  throw new Error("request was not created");
}

async function waitForResolvers(harness: FetchHarness, expectedCount: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (harness.createdResolvers.length >= expectedCount) {
      return;
    }
    await Promise.resolve();
  }

  throw new Error("resolver was not created");
}

function expectSafeError(error: Error, sensitiveValues: readonly string[]): void {
  const rendered = `${String(error)}${JSON.stringify(error)}`;
  for (const sensitiveValue of sensitiveValues) {
    expect(rendered).not.toContain(sensitiveValue);
  }
}

describe("remote image fetcher DNS resolution", () => {
  it("accepts one public A record", async () => {
    const { harness } = createSuccessHarness({}, publicResolver(["1.1.1.1"], []));

    await fetchFrom(harness);

    expect(harness.createdResolvers[0]?.resolve4Hostnames).toEqual(["images.example.com"]);
    expect(harness.createdResolvers[0]?.resolve6Hostnames).toEqual(["images.example.com"]);
  });

  it("accepts one public AAAA record", async () => {
    const { harness } = createSuccessHarness({}, publicResolver([], ["2606:4700:4700::1111"]));

    await fetchFrom(harness);

    expect(harness.capturedOptions[0]?.family).toBe(6);
  });

  it("accepts public A and AAAA records after validating both families", async () => {
    const { harness } = createSuccessHarness(
      {},
      publicResolver(["1.1.1.1"], ["2606:4700:4700::1111"])
    );

    await fetchFrom(harness);

    expect(harness.createdResolvers[0]?.resolve4Hostnames).toHaveLength(1);
    expect(harness.createdResolvers[0]?.resolve6Hostnames).toHaveLength(1);
  });

  it.each([
    ["private A record", ["10.0.0.1"], []],
    ["private AAAA record", [], ["fc00::1"]],
    ["private AAAA alongside public A", ["1.1.1.1"], ["fe80::1"]]
  ])("rejects %s as a whole DNS answer", async (_name, ipv4, ipv6) => {
    const harness = new FetchHarness([publicResolver(ipv4, ipv6)], []);

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_ADDRESS_FORBIDDEN");
    expect(harness.capturedOptions).toHaveLength(0);
  });

  it("supports a DNS response with only A records", async () => {
    const { harness } = createSuccessHarness({}, publicResolver(["8.8.8.8"], []));

    await fetchFrom(harness);

    expect(harness.capturedOptions[0]?.family).toBe(4);
  });

  it("supports a DNS response with only AAAA records", async () => {
    const { harness } = createSuccessHarness({}, publicResolver([], ["2001:4860:4860::8888"]));

    await fetchFrom(harness);

    expect(harness.capturedOptions[0]?.family).toBe(6);
  });

  it.each([
    ["both families empty", [], []],
    ["both families return no data", new DnsTestError(NODATA), new DnsTestError(NODATA)],
    ["both families are not found", new DnsTestError(NOTFOUND), new DnsTestError(NOTFOUND)]
  ])("rejects %s as DNS failed", async (_name, ipv4, ipv6) => {
    const harness = new FetchHarness([new FakeResolver(ipv4, ipv6)], []);

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_DNS_FAILED");
  });

  it("accepts production A records when the AAAA family returns Node no-data", async () => {
    const { harness } = createSuccessHarness(
      {},
      new FakeResolver(
        ["150.109.102.170", "124.156.129.98", "43.154.188.71"],
        new DnsTestError(NODATA)
      )
    );

    await fetchFrom(harness);

    expect(harness.capturedOptions[0]?.family).toBe(4);
    await expectLockedLookup(
      harness.capturedOptions[0],
      "150.109.102.170",
      4,
      false
    );
  });

  it("treats the Node no-data constant as absent only for that family", async () => {
    const { harness } = createSuccessHarness(
      {},
      new FakeResolver(new DnsTestError(NODATA), ["2606:4700:4700::1111"])
    );

    await fetchFrom(harness);

    expect(harness.capturedOptions[0]?.family).toBe(6);
    await expectLockedLookup(
      harness.capturedOptions[0],
      "2606:4700:4700::1111",
      6,
      false
    );
  });

  it("treats the Node not-found constant as absent only for that family", async () => {
    const { harness } = createSuccessHarness(
      {},
      new FakeResolver(["1.1.1.1"], new DnsTestError(NOTFOUND))
    );

    await fetchFrom(harness);

    expect(harness.capturedOptions[0]?.family).toBe(4);
  });

  it("maps the Node DNS timeout constant to the fixed DNS timeout error", async () => {
    const harness = new FetchHarness(
      [new FakeResolver(new DnsTestError(TIMEOUT), ["1.1.1.1"])],
      []
    );

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_DNS_TIMEOUT");
  });

  it.each([
    ["SERVFAIL", SERVFAIL],
    ["REFUSED", REFUSED],
    ["an unknown resolver error", "EUNKNOWN"]
  ])("maps %s to the fixed DNS failed error", async (_name, code) => {
    const harness = new FetchHarness(
      [new FakeResolver(new DnsTestError(code), ["1.1.1.1"])],
      []
    );

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_DNS_FAILED");
  });

  it("deduplicates addresses by address and family", async () => {
    const { harness } = createSuccessHarness(
      {},
      publicResolver(
        ["1.1.1.1", "1.1.1.1", "8.8.8.8"],
        ["2606:4700:4700::1111", "2606:4700:4700::1111"]
      )
    );

    await fetchFrom(harness);

    expect(harness.capturedOptions[0]?.family).toBe(4);
    expect(harness.capturedOptions[0]?.lookup).not.toBeUndefined();
  });

  it("rejects a resolver result whose IP family does not match its DNS family", async () => {
    const harness = new FetchHarness(
      [publicResolver(["2606:4700:4700::1111"], [])],
      []
    );

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_DNS_FAILED");
    expect(harness.capturedOptions).toHaveLength(0);
  });

  it("allows exactly 32 deduplicated public addresses", async () => {
    const ipv4 = Array.from({ length: 32 }, (_value, index) => `8.8.0.${index + 1}`);
    const { harness } = createSuccessHarness({}, publicResolver(ipv4, []));

    await fetchFrom(harness);

    expect(harness.capturedOptions).toHaveLength(1);
  });

  it("rejects 33 deduplicated public addresses", async () => {
    const ipv4 = Array.from({ length: 33 }, (_value, index) => `8.8.0.${index + 1}`);
    const harness = new FetchHarness([publicResolver(ipv4, [])], []);

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_ADDRESS_LIMIT");
  });

  it("selects the first IPv4 address before any IPv6 address", async () => {
    const { harness } = createSuccessHarness(
      {},
      publicResolver(["8.8.8.8", "1.1.1.1"], ["2606:4700:4700::1111"])
    );

    await fetchFrom(harness);

    expect(harness.capturedOptions[0]?.family).toBe(4);
    await expectLockedLookup(harness.capturedOptions[0], "8.8.8.8", 4, false);
  });

  it("does not attempt a second verified address when the first connection fails", async () => {
    const harness = new FetchHarness(
      [publicResolver(["8.8.8.8", "1.1.1.1"], [])],
      [{ requestError: new Error("raw socket failure") }]
    );

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_CONNECT_FAILED");
    expect(harness.capturedOptions).toHaveLength(1);
    expect(harness.createdResolvers).toHaveLength(1);
    expect(harness.requests[0]?.endCalls).toBe(1);
  });

  it("maps a socket failure after request end to the fixed connect error", async () => {
    const socket = new FakeSocket();
    const harness = new FetchHarness(
      [publicResolver()],
      [{ socket, socketError: new Error("raw socket failure") }]
    );

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_CONNECT_FAILED");
    expect(harness.requests[0]?.endCalls).toBe(1);
  });

  it("creates a resolver configured for one DNS try and a five-second query timeout", async () => {
    const { harness } = createSuccessHarness();

    await fetchFrom(harness);

    expect(harness.resolverOptions).toEqual([{ timeout: 5_000, tries: 1 }]);
  });
});

describe("remote image fetcher verified-IP HTTPS requests", () => {
  it("keeps the validated hostname for HTTPS, Host, and TLS SNI", async () => {
    const { harness } = createSuccessHarness();

    await fetchFrom(harness, { url: "https://IMAGES.EXAMPLE.COM/path/image.png?width=2" });

    const options = requireCapturedOptions(harness);
    expect(options.hostname).toBe("images.example.com");
    expect(options.servername).toBe("images.example.com");
    expect(options.headers).not.toHaveProperty("Host");
  });

  it("locks an IPv4 request to family 4", async () => {
    const { harness } = createSuccessHarness({}, publicResolver(["1.1.1.1"], []));

    await fetchFrom(harness);

    expect(requireCapturedOptions(harness).family).toBe(4);
  });

  it("locks an IPv6 request to family 6", async () => {
    const { harness } = createSuccessHarness({}, publicResolver([], ["2606:4700:4700::1111"]));

    await fetchFrom(harness);

    expect(requireCapturedOptions(harness).family).toBe(6);
  });

  it("disables automatic family selection and agents", async () => {
    const { harness } = createSuccessHarness();

    await fetchFrom(harness);

    const options = requireCapturedOptions(harness);
    expect(options.autoSelectFamily).toBe(false);
    expect(options.agent).toBe(false);
    expect(options.rejectUnauthorized).toBe(true);
    expect(options.protocol).toBe("https:");
    expect(options.port).toBe(443);
    expect(options.method).toBe("GET");
  });

  it("uses pathname and query as the request path", async () => {
    const { harness } = createSuccessHarness();

    await fetchFrom(harness, { url: "https://images.example.com/a/deep.png?width=1024" });

    expect(requireCapturedOptions(harness).path).toBe("/a/deep.png?width=1024");
  });

  it("returns the locked scalar lookup result without calling DNS again", async () => {
    const resolver = publicResolver(["1.1.1.1"], []);
    const { harness } = createSuccessHarness({}, resolver);

    await fetchFrom(harness);
    await expectLockedLookup(requireCapturedOptions(harness), "1.1.1.1", 4, false);

    expect(resolver.resolve4Hostnames).toHaveLength(1);
    expect(resolver.resolve6Hostnames).toHaveLength(1);
  });

  it("returns a one-element locked lookup result for all:true", async () => {
    const { harness } = createSuccessHarness({}, publicResolver([], ["2606:4700:4700::1111"]));

    await fetchFrom(harness);

    await expectLockedLookup(
      requireCapturedOptions(harness),
      "2606:4700:4700::1111",
      6,
      true
    );
  });

  it("uses only the fixed request headers", async () => {
    const { harness } = createSuccessHarness();

    await fetchFrom(harness);

    expect(requireCapturedOptions(harness).headers).toEqual({
      Accept: "image/png,image/jpeg,image/webp",
      "Accept-Encoding": "identity",
      "User-Agent": "AI-Aggregate-Asset-Fetcher/1.0"
    });
  });

  it("does not forward authorization, cookie, referer, or origin headers", async () => {
    const { harness } = createSuccessHarness();

    await fetchFrom(harness);

    const headers = requireCapturedOptions(harness).headers;
    expect(headers).not.toHaveProperty("Authorization");
    expect(headers).not.toHaveProperty("Cookie");
    expect(headers).not.toHaveProperty("Referer");
    expect(headers).not.toHaveProperty("Origin");
    expect(headers).not.toHaveProperty("X-Forwarded-For");
  });
});

describe("remote image fetcher redirects", () => {
  it.each([301, 302, 303, 307, 308])("follows supported redirect status %i", async (statusCode) => {
    const redirectResponse = response(statusCode, { location: "/final.png" });
    const finalResponse = response(200);
    const harness = new FetchHarness(
      [publicResolver(), publicResolver()],
      [{ response: redirectResponse }, { response: finalResponse }]
    );

    const result = await fetchFrom(harness);

    expect(result.redirectCount).toBe(1);
    expect(result.finalHostname).toBe("images.example.com");
    expect(redirectResponse.destroyCalls).toBe(1);
    expect(harness.requests).toHaveLength(2);
    expect(harness.requests.map((request) => request.endCalls)).toEqual([1, 1]);
  });

  it("follows a redirect to another allowed hostname", async () => {
    const harness = new FetchHarness(
      [publicResolver(), publicResolver(["8.8.8.8"], [])],
      [
        { response: response(302, { location: "https://static.example.net/final.png" }) },
        { response: response(200) }
      ]
    );

    const result = await fetchFrom(harness);

    expect(result.finalHostname).toBe("static.example.net");
    expect(harness.createdResolvers[1]?.resolve4Hostnames).toEqual(["static.example.net"]);
  });

  it.each([
    ["unallowed host", "https://evil.example/final.png"],
    ["HTTP downgrade", "http://images.example.com/final.png"],
    ["credential URL", "https://user:password@images.example.com/final.png"],
    ["fragment URL", "https://images.example.com/final.png#part"],
    ["non-443 port", "https://images.example.com:444/final.png"]
  ])("rejects a redirect to %s", async (_name, location) => {
    const redirectResponse = response(302, { location });
    const harness = new FetchHarness([publicResolver()], [{ response: redirectResponse }]);

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_REDIRECT_INVALID");
    expect(redirectResponse.destroyCalls).toBe(1);
    expect(harness.createdResolvers).toHaveLength(1);
  });

  it("rejects a redirect whose newly resolved address is private", async () => {
    const redirectResponse = response(302, { location: "https://static.example.net/final.png" });
    const harness = new FetchHarness(
      [publicResolver(), publicResolver(["10.0.0.1"], [])],
      [{ response: redirectResponse }]
    );

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_ADDRESS_FORBIDDEN");
    expect(harness.capturedOptions).toHaveLength(1);
  });

  it("rejects a redirect without a Location header", async () => {
    const redirectResponse = response(302);
    const harness = new FetchHarness([publicResolver()], [{ response: redirectResponse }]);

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_REDIRECT_INVALID");
    expect(redirectResponse.destroyCalls).toBe(1);
  });

  it("rejects a redirect with an empty Location header", async () => {
    const redirectResponse = response(302, { location: "" });
    const harness = new FetchHarness([publicResolver()], [{ response: redirectResponse }]);

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_REDIRECT_INVALID");
    expect(redirectResponse.destroyCalls).toBe(1);
  });

  it("rejects a redirect with an array Location header", async () => {
    const redirectResponse = response(302, { location: ["/a.png", "/b.png"] });
    const harness = new FetchHarness([publicResolver()], [{ response: redirectResponse }]);

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_REDIRECT_INVALID");
  });

  it("allows three redirects", async () => {
    const harness = new FetchHarness(
      [publicResolver(), publicResolver(), publicResolver(), publicResolver()],
      [
        { response: response(302, { location: "/one.png" }) },
        { response: response(302, { location: "/two.png" }) },
        { response: response(302, { location: "/three.png" }) },
        { response: response(200) }
      ]
    );

    const result = await fetchFrom(harness);

    expect(result.redirectCount).toBe(3);
    expect(harness.createdResolvers).toHaveLength(4);
  });

  it("rejects the fourth redirect", async () => {
    const fourthRedirect = response(302, { location: "/four.png" });
    const harness = new FetchHarness(
      [publicResolver(), publicResolver(), publicResolver(), publicResolver()],
      [
        { response: response(302, { location: "/one.png" }) },
        { response: response(302, { location: "/two.png" }) },
        { response: response(302, { location: "/three.png" }) },
        { response: fourthRedirect }
      ]
    );

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_REDIRECT_LIMIT");
    expect(fourthRedirect.destroyCalls).toBe(1);
  });

  it("detects an A to B to A redirect loop without retaining URLs", async () => {
    const firstRedirect = response(302, { location: "https://static.example.net/final.png" });
    const secondRedirect = response(302, { location: sourceUrl });
    const harness = new FetchHarness(
      [publicResolver(), publicResolver()],
      [{ response: firstRedirect }, { response: secondRedirect }]
    );

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_REDIRECT_LOOP");
    expect(firstRedirect.destroyCalls).toBe(1);
    expect(secondRedirect.destroyCalls).toBe(1);
    expect(harness.createdResolvers).toHaveLength(2);
  });

  it("uses a fresh resolver and fresh locked lookup for every redirect hop", async () => {
    const harness = new FetchHarness(
      [publicResolver(["1.1.1.1"], []), publicResolver(["8.8.8.8"], [])],
      [
        { response: response(302, { location: "https://static.example.net/final.png" }) },
        { response: response(200) }
      ]
    );

    await fetchFrom(harness);

    expect(harness.createdResolvers).toHaveLength(2);
    expect(harness.capturedOptions).toHaveLength(2);
    expect(harness.capturedOptions[0]?.lookup).not.toBe(harness.capturedOptions[1]?.lookup);
    await expectLockedLookup(harness.capturedOptions[1], "8.8.8.8", 4, false);
  });

  it("does not forward sensitive headers across redirects", async () => {
    const harness = new FetchHarness(
      [publicResolver(), publicResolver()],
      [
        { response: response(302, { location: "/final.png" }) },
        { response: response(200) }
      ]
    );

    await fetchFrom(harness);

    expect(harness.capturedOptions).toHaveLength(2);
    for (const options of harness.capturedOptions) {
      expect(options.headers).toEqual({
        Accept: "image/png,image/jpeg,image/webp",
        "Accept-Encoding": "identity",
        "User-Agent": "AI-Aggregate-Asset-Fetcher/1.0"
      });
    }
  });
});

describe("remote image fetcher final responses", () => {
  it("returns only the safe result metadata and the 200 response stream", async () => {
    const { harness, response: finalResponse } = createSuccessHarness({
      "content-type": "image/png",
      "content-length": "123"
    });

    const result = await fetchFrom(harness);

    expect(result.stream).toBe(finalResponse);
    expect(Object.keys(result).sort()).toEqual([
      "cancel",
      "contentLength",
      "contentType",
      "finalHostname",
      "redirectCount",
      "sourceUrlHash",
      "stream"
    ]);
    expect(result.contentType).toBe("image/png");
    expect(result.contentLength).toBe(123);
    expect(result.finalHostname).toBe("images.example.com");
    expect(result.redirectCount).toBe(0);
    expect(result.sourceUrlHash).toBe(
      createHash("sha256").update(sourceUrl).digest("hex")
    );
  });

  it.each([
    ["201", 201],
    ["204", 204],
    ["404", 404],
    ["500", 500],
    ["101", 101],
    ["unsupported 304", 304],
    ["missing status", undefined]
  ])("rejects final response status %s", async (_name, statusCode) => {
    const finalResponse = response(statusCode);
    const harness = new FetchHarness([publicResolver()], [{ response: finalResponse }]);

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_HTTP_STATUS");
    expect(finalResponse.destroyCalls).toBe(1);
  });

  it.each([
    ["missing Content-Encoding", undefined],
    ["identity Content-Encoding", "identity"],
    ["case-insensitive identity Content-Encoding", "IDENTITY"]
  ])("accepts %s", async (_name, contentEncoding) => {
    const { harness } = createSuccessHarness({ "content-encoding": contentEncoding });

    await expect(fetchFrom(harness)).resolves.toMatchObject({ redirectCount: 0 });
  });

  it.each([
    ["gzip", "gzip"],
    ["br", "br"],
    ["deflate", "deflate"],
    ["multiple encodings", "identity, gzip"],
    ["array encoding", ["identity", "gzip"]]
  ])("rejects %s Content-Encoding", async (_name, contentEncoding) => {
    const finalResponse = response(200, { "content-encoding": contentEncoding });
    const harness = new FetchHarness([publicResolver()], [{ response: finalResponse }]);

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_CONTENT_ENCODING_FORBIDDEN");
    expect(finalResponse.destroyCalls).toBe(1);
  });

  it("returns a single Content-Type string unchanged", async () => {
    const { harness } = createSuccessHarness({ "content-type": "image/webp; charset=binary" });

    const result = await fetchFrom(harness);

    expect(result.contentType).toBe("image/webp; charset=binary");
  });

  it.each([
    ["array", ["image/png", "image/jpeg"]],
    ["multi-value string", "image/png,image/jpeg"],
    ["empty string", ""]
  ])("returns null for %s Content-Type", async (_name, contentType) => {
    const { harness } = createSuccessHarness({ "content-type": contentType });

    const result = await fetchFrom(harness);

    expect(result.contentType).toBeNull();
  });

  it.each([
    ["zero", "0", 0],
    ["positive", "123", 123]
  ])("returns valid %s Content-Length", async (_name, contentLength, expected) => {
    const { harness } = createSuccessHarness({ "content-length": contentLength });

    const result = await fetchFrom(harness);

    expect(result.contentLength).toBe(expected);
  });

  it.each([
    ["missing", undefined],
    ["negative", "-1"],
    ["decimal", "1.5"],
    ["multiple", "1,2"],
    ["unsafe integer", "9007199254740992"],
    ["array", ["1", "2"]]
  ])("returns null for %s Content-Length", async (_name, contentLength) => {
    const { harness } = createSuccessHarness({ "content-length": contentLength });

    const result = await fetchFrom(harness);

    expect(result.contentLength).toBeNull();
  });
});

describe("remote image fetcher timeouts and cancellation", () => {
  it("cancels the DNS resolver and returns the DNS timeout error", async () => {
    const deferred = new Deferred<readonly string[]>();
    const resolver = new FakeResolver(deferred.promise, deferred.promise);
    const harness = new FetchHarness([resolver], []);
    const operation = fetchFrom(harness);

    await waitForResolvers(harness, 1);
    harness.scheduler.fire(5_000);

    const error = await captureFetcherError(operation);
    expect(error.code).toBe("REMOTE_IMAGE_DNS_TIMEOUT");
    expect(resolver.cancelCalls).toBe(1);
  });

  it("destroys the request on connect timeout", async () => {
    const harness = new FetchHarness([publicResolver()], [{}]);
    const operation = fetchFrom(harness);

    await waitForRequests(harness, 1);
    harness.scheduler.fire(10_000);

    const error = await captureFetcherError(operation);
    expect(error.code).toBe("REMOTE_IMAGE_CONNECT_TIMEOUT");
    expect(harness.requests[0]?.destroyCalls).toBe(1);
  });

  it("clears the connect timer at secureConnect and times out waiting for headers", async () => {
    const socket = new FakeSocket();
    const harness = new FetchHarness([publicResolver()], [{ socket }]);
    const operation = fetchFrom(harness);

    await waitForRequests(harness, 1);
    await flushMicrotasks();
    harness.scheduler.fire(15_000);

    const error = await captureFetcherError(operation);
    expect(error.code).toBe("REMOTE_IMAGE_HEADERS_TIMEOUT");
    expect(harness.requests[0]?.endCalls).toBe(1);
    expect(harness.requests[0]?.destroyCalls).toBe(1);
    expect(socket.destroyCalls).toBe(1);
  });

  it("uses the overall deadline while DNS is pending", async () => {
    const deferred = new Deferred<readonly string[]>();
    const resolver = new FakeResolver(deferred.promise, deferred.promise);
    const harness = new FetchHarness([resolver], []);
    const operation = fetchFrom(harness);

    await waitForResolvers(harness, 1);
    harness.scheduler.fire(30_000);

    const error = await captureFetcherError(operation);
    expect(error.code).toBe("REMOTE_IMAGE_TIMEOUT");
    expect(resolver.cancelCalls).toBe(1);
  });

  it("shares one overall deadline across redirects", async () => {
    const deferred = new Deferred<readonly string[]>();
    const secondResolver = new FakeResolver(deferred.promise, deferred.promise);
    const harness = new FetchHarness(
      [publicResolver(), secondResolver],
      [{ response: response(302, { location: "/final.png" }) }]
    );
    const operation = fetchFrom(harness);

    await waitForResolvers(harness, 2);
    harness.scheduler.fire(30_000);

    const error = await captureFetcherError(operation);
    expect(error.code).toBe("REMOTE_IMAGE_TIMEOUT");
    expect(secondResolver.cancelCalls).toBe(1);
    expect(harness.resolverOptions).toHaveLength(2);
  });

  it("fails immediately when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = new FetchHarness([], []);

    const error = await captureFetcherError(fetchFrom(harness, { signal: controller.signal }));

    expect(error.code).toBe("REMOTE_IMAGE_ABORTED");
    expect(harness.resolverOptions).toHaveLength(0);
  });

  it("cancels DNS when the caller aborts during resolution", async () => {
    const deferred = new Deferred<readonly string[]>();
    const resolver = new FakeResolver(deferred.promise, deferred.promise);
    const controller = new AbortController();
    const harness = new FetchHarness([resolver], []);
    const operation = fetchFrom(harness, { signal: controller.signal });

    await waitForResolvers(harness, 1);
    controller.abort();

    const error = await captureFetcherError(operation);
    expect(error.code).toBe("REMOTE_IMAGE_ABORTED");
    expect(resolver.cancelCalls).toBe(1);
  });

  it("destroys the in-flight request when the caller aborts during connection", async () => {
    const controller = new AbortController();
    const harness = new FetchHarness([publicResolver()], [{}]);
    const operation = fetchFrom(harness, { signal: controller.signal });

    await waitForRequests(harness, 1);
    controller.abort();

    const error = await captureFetcherError(operation);
    expect(error.code).toBe("REMOTE_IMAGE_ABORTED");
    expect(harness.requests[0]?.destroyCalls).toBe(1);
  });

  it("cancels the newly created resolver when the caller aborts during a redirect", async () => {
    const deferred = new Deferred<readonly string[]>();
    const secondResolver = new FakeResolver(deferred.promise, deferred.promise);
    const controller = new AbortController();
    const harness = new FetchHarness(
      [publicResolver(), secondResolver],
      [{ response: response(302, { location: "/final.png" }) }]
    );
    const operation = fetchFrom(harness, { signal: controller.signal });

    await waitForResolvers(harness, 2);
    controller.abort();

    const error = await captureFetcherError(operation);
    expect(error.code).toBe("REMOTE_IMAGE_ABORTED");
    expect(secondResolver.cancelCalls).toBe(1);
  });

  it("destroys the returned stream when the caller aborts later", async () => {
    const controller = new AbortController();
    const { harness, response: finalResponse } = createSuccessHarness();

    await fetchFrom(harness, { signal: controller.signal });
    controller.abort();

    expect(finalResponse.destroyCalls).toBe(1);
  });

  it("makes cancel idempotent", async () => {
    const { harness, response: finalResponse } = createSuccessHarness();
    const result = await fetchFrom(harness);

    result.cancel();
    result.cancel();

    expect(finalResponse.destroyCalls).toBe(1);
  });

  it("removes the external signal listener after the stream ends", async () => {
    const controller = new AbortController();
    const { harness, response: finalResponse } = createSuccessHarness();
    await fetchFrom(harness, { signal: controller.signal });

    finalResponse.emit("end");
    controller.abort();

    expect(finalResponse.destroyCalls).toBe(0);
  });

  it.each(["close", "error"])(
    "removes the external signal listener after stream %s",
    async (eventName) => {
      const controller = new AbortController();
      const { harness, response: finalResponse } = createSuccessHarness();
      await fetchFrom(harness, { signal: controller.signal });

      finalResponse.emit(eventName, eventName === "error" ? new Error("stream closed") : undefined);
      controller.abort();

      expect(finalResponse.destroyCalls).toBe(0);
    }
  );

  it("cleans every establishment timer after a successful response", async () => {
    const socket = new FakeSocket();
    const harness = new FetchHarness(
      [publicResolver()],
      [{ socket, response: response(200) }]
    );

    await fetchFrom(harness);

    expect(harness.requests[0]?.endCalls).toBe(1);
    expect(harness.scheduler.activeTimers()).toEqual([]);
  });
});

describe("remote image fetcher errors are safe and tests use no live transport", () => {
  it("does not disclose query tokens, credentials, IPs, or Location values", async () => {
    const sensitiveLocation = "https://user:password@evil.example/final.png?token=redirect-secret";
    const harness = new FetchHarness(
      [publicResolver()],
      [{ response: response(302, { location: sensitiveLocation }) }]
    );

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_REDIRECT_INVALID");
    expectSafeError(error, ["redirect-secret", "user:password", sensitiveLocation, "evil.example"]);
  });

  it("does not disclose a forbidden DNS address", async () => {
    const harness = new FetchHarness([publicResolver(["10.0.0.1"], [])], []);

    const error = await captureFetcherError(fetchFrom(harness));

    expectSafeError(error, ["10.0.0.1"]);
  });

  it("does not disclose raw socket error text", async () => {
    const rawSocketError = new Error("socket-token=raw-secret");
    const harness = new FetchHarness(
      [publicResolver()],
      [{ requestError: rawSocketError }]
    );

    const error = await captureFetcherError(fetchFrom(harness));

    expect(error.code).toBe("REMOTE_IMAGE_CONNECT_FAILED");
    expectSafeError(error, ["raw-secret", "socket-token"]);
  });

  it("serializes only fixed error properties", () => {
    const error = new RemoteImageFetcherError("REMOTE_IMAGE_CONNECT_FAILED", "connect");

    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: "RemoteImageFetcherError",
      code: "REMOTE_IMAGE_CONNECT_FAILED",
      stage: "connect"
    });
  });

  it("uses injected DNS and request implementations for every test request", async () => {
    const { harness } = createSuccessHarness();

    await fetchFrom(harness);

    expect(harness.createdResolvers).toHaveLength(1);
    expect(harness.capturedOptions).toHaveLength(1);
    expect(harness.requests).toHaveLength(1);
  });
});

function requireCapturedOptions(harness: FetchHarness): RequestOptions {
  const options = harness.capturedOptions[0];
  if (options === undefined) {
    throw new Error("expected captured request options");
  }

  return options;
}

async function expectLockedLookup(
  options: RequestOptions | undefined,
  expectedAddress: string,
  expectedFamily: number,
  all: boolean
): Promise<void> {
  if (options === undefined || options.lookup === undefined) {
    throw new Error("expected locked lookup");
  }
  const lookup = options.lookup;

  await new Promise<void>((resolve, reject) => {
    lookup("untrusted-input.example", { all }, (error, address, family) => {
      if (error !== null) {
        reject(error);
        return;
      }

      if (all) {
        expect(address).toEqual([{ address: expectedAddress, family: expectedFamily }]);
        expect(family).toBeUndefined();
      } else {
        expect(address).toBe(expectedAddress);
        expect(family).toBe(expectedFamily);
      }
      resolve();
    });
  });
}
