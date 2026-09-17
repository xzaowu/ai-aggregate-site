import { describe, expect, it } from "vitest";
import {
  RemoteImageUrlPolicyError,
  isPublicRemoteAddress,
  parseRemoteImageAllowedHostRules,
  validateRemoteImageDownloadUrl
} from "../src/remote-image-url-policy";

const standardRules = parseRemoteImageAllowedHostRules(
  "images.example.com,*.cdn.example.com,static.example.net"
);

function expectPolicyError(
  action: () => void,
  code: "REMOTE_IMAGE_ALLOWLIST_INVALID" | "REMOTE_IMAGE_URL_INVALID",
  reason?:
    | "MALFORMED_URL"
    | "HOST_NOT_ALLOWED"
    | "OTHER_POLICY_VIOLATION"
    | "PROTOCOL_NOT_ALLOWED"
    | "CREDENTIALS_NOT_ALLOWED"
    | "PORT_NOT_ALLOWED"
    | "FRAGMENT_NOT_ALLOWED"
): RemoteImageUrlPolicyError {
  try {
    action();
  } catch (error) {
      expect(error).toBeInstanceOf(RemoteImageUrlPolicyError);
    if (error instanceof RemoteImageUrlPolicyError) {
      expect(error.code).toBe(code);
      if (reason !== undefined) {
        expect(error.reason).toBe(reason);
      }
      return error;
    }
  }

  throw new Error("expected remote image URL policy error");
}

describe("remote image allowlist parsing", () => {
  it("parses a single exact hostname", () => {
    expect(parseRemoteImageAllowedHostRules("images.example.com")).toEqual([
      { kind: "exact", hostname: "images.example.com" }
    ]);
  });

  it("parses multiple exact hostnames", () => {
    expect(
      parseRemoteImageAllowedHostRules("images.example.com,static.example.net")
    ).toEqual([
      { kind: "exact", hostname: "images.example.com" },
      { kind: "exact", hostname: "static.example.net" }
    ]);
  });

  it("parses a single wildcard hostname", () => {
    expect(parseRemoteImageAllowedHostRules("*.cdn.example.com")).toEqual([
      { kind: "wildcard", hostname: "cdn.example.com" }
    ]);
  });

  it("parses mixed exact and wildcard hostnames", () => {
    expect(
      parseRemoteImageAllowedHostRules(
        "images.example.com,*.cdn.example.com,static.example.net"
      )
    ).toEqual([
      { kind: "exact", hostname: "images.example.com" },
      { kind: "wildcard", hostname: "cdn.example.com" },
      { kind: "exact", hostname: "static.example.net" }
    ]);
  });

  it("normalizes lowercase and one trailing dot", () => {
    expect(parseRemoteImageAllowedHostRules(" IMAGES.EXAMPLE.COM. ")).toEqual([
      { kind: "exact", hostname: "images.example.com" }
    ]);
  });

  it("deduplicates normalized rules", () => {
    expect(
      parseRemoteImageAllowedHostRules(
        "images.example.com,IMAGES.EXAMPLE.COM.,*.cdn.example.com,*.CDN.EXAMPLE.COM."
      )
    ).toEqual([
      { kind: "exact", hostname: "images.example.com" },
      { kind: "wildcard", hostname: "cdn.example.com" }
    ]);
  });

  it("accepts legal ASCII punycode", () => {
    expect(parseRemoteImageAllowedHostRules("xn--bcher-kva.example")).toEqual([
      { kind: "exact", hostname: "xn--bcher-kva.example" }
    ]);
  });

  it.each([
    ["empty input", ""],
    ["whitespace-only input", "  \t "],
    ["empty item", "images.example.com, ,static.example.net"],
    ["bare wildcard", "*"],
    ["internal wildcard", "cdn.*.example.com"],
    ["multiple wildcards", "*.*.example.com"],
    ["protocol", "https://images.example.com"],
    ["path", "images.example.com/path"],
    ["query", "images.example.com?token=value"],
    ["fragment", "images.example.com#section"],
    ["credential", "user:password@images.example.com"],
    ["port", "images.example.com:443"],
    ["IPv4 literal", "127.0.0.1"],
    ["IPv6 literal", "[::1]"],
    ["Unicode hostname", "bücher.example"],
    ["overlong label", `${"a".repeat(64)}.example.com`],
    [
      "overlong hostname",
      `${"a".repeat(63)}.${"a".repeat(63)}.${"a".repeat(63)}.${"a".repeat(62)}`
    ],
    ["leading label hyphen", "-images.example.com"],
    ["trailing label hyphen", "images-.example.com"],
    ["consecutive empty labels", "images..example.com"],
    ["invalid punycode", "xn--.example"]
  ])("rejects %s without exposing the configuration", (_name, value) => {
    const error = expectPolicyError(
      () => parseRemoteImageAllowedHostRules(value),
      "REMOTE_IMAGE_ALLOWLIST_INVALID"
    );
    if (value.length > 0) {
      expect(String(error)).not.toContain(value);
      expect(JSON.stringify(error)).not.toContain(value);
    }
  });
});

describe("remote image URL validation", () => {
  it.each([
    ["malformed URL", "https://", "MALFORMED_URL"],
    ["host not allowed", "https://blocked.example.com/image.png", "HOST_NOT_ALLOWED"],
    ["non-HTTPS protocol", "http://images.example.com/image.png", "PROTOCOL_NOT_ALLOWED"],
    ["credentials", "https://user:password@images.example.com/image.png", "CREDENTIALS_NOT_ALLOWED"],
    ["non-default port", "https://images.example.com:444/image.png", "PORT_NOT_ALLOWED"],
    ["fragment", "https://images.example.com/image.png#preview", "FRAGMENT_NOT_ALLOWED"]
  ] as const)("classifies %s with fixed internal reason", (_label, value, reason) => {
    const error = expectPolicyError(
      () => validateRemoteImageDownloadUrl(value, standardRules),
      "REMOTE_IMAGE_URL_INVALID",
      reason
    );

    expect(error.message).toBe("remote image URL is invalid or not allowed");
    expect(error).not.toHaveProperty("url");
    expect(error).not.toHaveProperty("host");
    expect(JSON.stringify(error)).not.toContain(value);
  });

  it("accepts an exact hostname", () => {
    const result = validateRemoteImageDownloadUrl(
      " https://IMAGES.EXAMPLE.COM/files/image.png?size=large ",
      standardRules
    );

    expect(result).toMatchObject({
      protocol: "https:",
      hostname: "images.example.com",
      port: "",
      pathname: "/files/image.png",
      search: "?size=large"
    });
    expect(result.url).toBeInstanceOf(URL);
  });

  it("accepts exactly one wildcard label", () => {
    expect(
      validateRemoteImageDownloadUrl(
        "https://origin.cdn.example.com/image.png",
        standardRules
      ).hostname
    ).toBe("origin.cdn.example.com");
  });

  it.each([
    ["wildcard apex", "https://cdn.example.com/image.png"],
    ["two wildcard labels", "https://deep.origin.cdn.example.com/image.png"],
    ["evil suffix", "https://cdn.example.com.evil.example/image.png"],
    ["localhost", "https://localhost/image.png"],
    ["IPv4 literal", "https://127.0.0.1/image.png"],
    ["IPv6 literal", "https://[::1]/image.png"],
    ["decimal IPv4 literal", "https://2130706433/image.png"],
    ["octal IPv4 literal", "https://0177.0.0.1/image.png"],
    ["hexadecimal IPv4 literal", "https://0x7f.0x0.0x0.0x1/image.png"]
  ])("rejects %s", (_name, value) => {
    expectPolicyError(
      () => validateRemoteImageDownloadUrl(value, standardRules),
      "REMOTE_IMAGE_URL_INVALID"
    );
  });

  it.each([
    ["http protocol", "http://images.example.com/image.png"],
    ["protocol-relative URL", "//images.example.com/image.png"],
    ["data URL", "data:image/png;base64,AAAA"],
    ["blob URL", "blob:https://images.example.com/image.png"],
    ["file URL", "file:///tmp/image.png"],
    ["credential", "https://user:password@images.example.com/image.png"],
    ["empty credential", "https://@images.example.com/image.png"],
    ["fragment", "https://images.example.com/image.png#preview"],
    ["empty fragment", "https://images.example.com/image.png#"],
    ["non-default port", "https://images.example.com:444/image.png"],
    ["empty URL", "  "],
    ["invalid URL", "https://"]
  ])("rejects %s", (_name, value) => {
    expectPolicyError(
      () => validateRemoteImageDownloadUrl(value, standardRules),
      "REMOTE_IMAGE_URL_INVALID"
    );
  });

  it("accepts an explicit port 443", () => {
    const result = validateRemoteImageDownloadUrl(
      "https://images.example.com:443/image.png",
      standardRules
    );
    expect(result.port).toBe("");
  });

  it("preserves the query string", () => {
    const result = validateRemoteImageDownloadUrl(
      "https://images.example.com/image.png?width=1024&format=webp",
      standardRules
    );
    expect(result.search).toBe("?width=1024&format=webp");
  });

  it("preserves the pathname", () => {
    const result = validateRemoteImageDownloadUrl(
      "https://images.example.com/a/deep/image.png",
      standardRules
    );
    expect(result.pathname).toBe("/a/deep/image.png");
  });

  it("normalizes a mixed-case hostname", () => {
    expect(
      validateRemoteImageDownloadUrl(
        "https://IMAGES.Example.COM/image.png",
        standardRules
      ).hostname
    ).toBe("images.example.com");
  });

  it("normalizes one trailing hostname dot", () => {
    expect(
      validateRemoteImageDownloadUrl(
        "https://images.example.com./image.png",
        standardRules
      ).hostname
    ).toBe("images.example.com");
  });

  it("does not expose URL credentials or query tokens in errors", () => {
    const sensitiveUrl =
      "https://user:password@images.example.com/file.png?token=super-secret";
    const error = expectPolicyError(
      () => validateRemoteImageDownloadUrl(sensitiveUrl, standardRules),
      "REMOTE_IMAGE_URL_INVALID",
      "CREDENTIALS_NOT_ALLOWED"
    );
    const renderedError = `${String(error)}${JSON.stringify(error)}`;

    expect(renderedError).not.toContain("super-secret");
    expect(renderedError).not.toContain(sensitiveUrl);
    expect(renderedError).not.toContain("user:password");
    expect(renderedError).not.toContain("images.example.com");
  });

  it("does not serialize a signed query canary", () => {
    const value = "https://blocked.example.com/image.png?signature=policy-canary";
    const error = expectPolicyError(
      () => validateRemoteImageDownloadUrl(value, standardRules),
      "REMOTE_IMAGE_URL_INVALID",
      "HOST_NOT_ALLOWED"
    );

    expect(JSON.stringify(error)).not.toContain("policy-canary");
    expect(JSON.stringify(error)).not.toContain("blocked.example.com");
  });
});

describe("public remote IP address classification", () => {
  it.each(["1.1.1.1", "8.8.8.8", "93.184.216.34"])(
    "accepts public IPv4 %s",
    (address) => {
      expect(isPublicRemoteAddress(address)).toBe(true);
    }
  );

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255"
  ])("rejects non-public IPv4 %s", (address) => {
    expect(isPublicRemoteAddress(address)).toBe(false);
  });

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "accepts public IPv6 %s",
    (address) => {
      expect(isPublicRemoteAddress(address)).toBe(true);
    }
  );

  it.each([
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd00::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254"
  ])("rejects non-public IPv6 %s", (address) => {
    expect(isPublicRemoteAddress(address)).toBe(false);
  });

  it("extracts IPv4-mapped IPv6 before deciding public reachability", () => {
    expect(isPublicRemoteAddress("::ffff:8.8.8.8")).toBe(true);
  });

  it.each(["64:ff9b::1", "2002::1", "2001::1"])(
    "rejects non-unicast IPv6 transition range %s",
    (address) => {
      expect(isPublicRemoteAddress(address)).toBe(false);
    }
  );

  it.each([null, "", "   ", 1, {}, "not-an-address"])(
    "returns false for invalid address input %p",
    (address) => {
      expect(isPublicRemoteAddress(address)).toBe(false);
    }
  );
});
