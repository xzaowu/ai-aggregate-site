import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEpaySignString,
  epaySafeConfig,
  isEpayPaymentType,
  normalizeEpayParams,
  parseEpayNotifyParams,
  readEpayCallbackVerificationConfig,
  readEpayConfig,
  readEpayConfigFromDb,
  signEpayParams,
  verifyEpaySignature,
  type EpayConfig,
  type EpayCallbackVerificationSetting
} from "../src/payments/epay";
import {
  EPAY_RECOVERY_QUERY_TIMEOUT_MS,
  EPAY_RECOVERY_TRADE_NO_MAX_LENGTH,
  recoverExistingEpayPaymentSession,
  resolveEpayRecoveryQueryOrigin
} from "../src/payments/epay-recovery";

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Config tests
// ---------------------------------------------------------------------------

function buildEnv(overrides: Record<string, string> = {}): Partial<NodeJS.ProcessEnv> {
  return {
    EPAY_ENABLED: "false",
    EPAY_GATEWAY_URL: "",
    EPAY_PID: "",
    EPAY_KEY: "",
    EPAY_NOTIFY_URL: "",
    EPAY_RETURN_URL: "",
    ...overrides
  };
}

const fullEnv: Record<string, string> = {
  EPAY_ENABLED: "true",
  EPAY_GATEWAY_URL: "https://epay.example.com",
  EPAY_PID: "1001",
  EPAY_KEY: "secret-merchant-key",
  EPAY_NOTIFY_URL: "https://mysite.example.com/api/epay/notify",
  EPAY_RETURN_URL: "https://mysite.example.com/payment/return"
};

describe("readEpayConfig", () => {
  it("returns disabled when EPAY_ENABLED is not true", () => {
    const config = readEpayConfig(buildEnv({ EPAY_ENABLED: "false" }));
    expect(config.enabled).toBe(false);
  });

  it("returns disabled when EPAY_ENABLED is missing", () => {
    const config = readEpayConfig(buildEnv({ EPAY_ENABLED: "" }));
    expect(config.enabled).toBe(false);
  });

  it("returns disabled when EPAY_ENABLED is 0", () => {
    const config = readEpayConfig(buildEnv({ EPAY_ENABLED: "0" }));
    expect(config.enabled).toBe(false);
  });

  it("returns enabled with full config when all vars are present", () => {
    const config = readEpayConfig(fullEnv);
    expect(config.enabled).toBe(true);
    expect(config.gatewayUrl).toBe("https://epay.example.com");
    expect(config.pid).toBe("1001");
    expect(config.key).toBe("secret-merchant-key");
    expect(config.notifyUrl).toBe("https://mysite.example.com/api/epay/notify");
    expect(config.returnUrl).toBe("https://mysite.example.com/payment/return");
  });

  it("exposes EPAY_KEY in raw config (it is only filtered in safeConfig)", () => {
    const config = readEpayConfig(fullEnv);
    expect(config.key).toBe("secret-merchant-key");
  });
});

describe("readEpayConfigFromDb", () => {
  it("reports mixed provenance when an enabled database row uses the env key fallback", () => {
    const config = readEpayConfigFromDb(
      {
        id: "payment-setting-1",
        provider: "epay",
        enabled: true,
        gatewayUrl: "https://db-epay.example.com",
        pid: "db-merchant-1001",
        decryptedKey: null,
        notifyUrl: "https://site.example.com/api/payments/epay/notify",
        returnUrl: "https://site.example.com/payment/result",
        createdAt: "2026-08-28T00:00:00.000Z",
        updatedAt: "2026-08-28T00:00:00.000Z"
      },
      buildEnv({ EPAY_KEY: "env-fallback-key" })
    );

    expect(config.key).toBe("env-fallback-key");
    expect(config.source).toBe("mixed");
  });
});

describe("readEpayCallbackVerificationConfig", () => {
  function buildDbSetting(
    overrides: Partial<EpayCallbackVerificationSetting> = {}
  ): EpayCallbackVerificationSetting {
    return {
      pid: "db-merchant-1001",
      decryptedKey: "db-callback-key",
      ...overrides
    };
  }

  it("resolves a valid enabled database merchant identity and key", () => {
    expect(
      readEpayCallbackVerificationConfig(buildDbSetting(), fullEnv)
    ).toEqual({
      pid: "db-merchant-1001",
      key: "db-callback-key",
      source: "database"
    });
  });

  it("ignores disabled initiation state for a valid database verification config", () => {
    expect(
      readEpayCallbackVerificationConfig(
        buildDbSetting(),
        buildEnv()
      )
    ).toEqual({
      pid: "db-merchant-1001",
      key: "db-callback-key",
      source: "database"
    });
  });

  it("uses only the existing env-key fallback when a database record owns the pid", () => {
    expect(
      readEpayCallbackVerificationConfig(
        buildDbSetting({ decryptedKey: null }),
        buildEnv({
          EPAY_PID: "different-env-pid",
          EPAY_KEY: "fallback-env-key"
        })
      )
    ).toEqual({
      pid: "db-merchant-1001",
      key: "fallback-env-key",
      source: "database"
    });
  });

  it("resolves env verification material even when new initiation is disabled", () => {
    expect(
      readEpayCallbackVerificationConfig(
        null,
        buildEnv({
          EPAY_ENABLED: "false",
          EPAY_PID: "env-merchant-1001",
          EPAY_KEY: "env-callback-key"
        })
      )
    ).toEqual({
      pid: "env-merchant-1001",
      key: "env-callback-key",
      source: "env"
    });
  });

  it("fails closed when the selected database or env source is incomplete", () => {
    expect(
      readEpayCallbackVerificationConfig(
        buildDbSetting({ pid: null, decryptedKey: null }),
        buildEnv({
          EPAY_PID: "must-not-replace-db-pid",
          EPAY_KEY: "fallback-env-key"
        })
      )
    ).toBeNull();
    expect(
      readEpayCallbackVerificationConfig(
        null,
        buildEnv({ EPAY_PID: "env-merchant-1001", EPAY_KEY: "" })
      )
    ).toBeNull();
  });
});

describe("epaySafeConfig", () => {
  it("returns enabled=true when EPay is fully configured", () => {
    const raw = readEpayConfig(fullEnv);
    const safe = epaySafeConfig(raw);
    expect(safe.enabled).toBe(true);
    expect(safe.misconfigured).toBe(false);
  });

  it("never exposes EPAY_KEY in safe config", () => {
    const raw = readEpayConfig(fullEnv);
    const safe = epaySafeConfig(raw);
    expect(safe).not.toHaveProperty("key");
    // TypeScript safety blanket: cast to check runtime absence
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((safe as any).key).toBeUndefined();
  });

  it("returns misconfigured when EPAY_ENABLED is true but vars are missing", () => {
    const raw: EpayConfig = {
      enabled: true,
      gatewayUrl: "https://epay.example.com",
      pid: "",
      key: "",
      notifyUrl: "",
      returnUrl: "",
      source: "env"
    };
    const safe = epaySafeConfig(raw);
    expect(safe.enabled).toBe(false);
    expect(safe.misconfigured).toBe(true);
  });

  it("returns disabled and not misconfigured when EPay is explicitly off", () => {
    const raw = readEpayConfig(buildEnv({ EPAY_ENABLED: "false" }));
    const safe = epaySafeConfig(raw);
    expect(safe.enabled).toBe(false);
    expect(safe.misconfigured).toBe(false);
    expect(safe.missingFields).toEqual([]);
  });

  it("does not expose gatewayUrl/pid when EPay is disabled", () => {
    const raw = readEpayConfig(buildEnv({ EPAY_ENABLED: "false" }));
    const safe = epaySafeConfig(raw);
    expect(safe.gatewayUrl).toBe("");
    expect(safe.pid).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Signing tests
// ---------------------------------------------------------------------------

const MERCHANT_KEY = "my-secret-key-123";

describe("normalizeEpayParams", () => {
  it("removes null, undefined, and empty string values", () => {
    const result = normalizeEpayParams({
      pid: "1001",
      money: "29.00",
      name: "",
      extra: null,
      note: undefined
    });
    expect(result).toEqual({
      pid: "1001",
      money: "29.00"
    });
  });

  it("removes sign and sign_type keys", () => {
    const result = normalizeEpayParams({
      pid: "1001",
      sign: "abc123",
      sign_type: "MD5",
      money: "29.00"
    });
    expect(result).toEqual({
      pid: "1001",
      money: "29.00"
    });
  });
});

describe("buildEpaySignString", () => {
  it("sorts keys alphabetically", () => {
    const signString = buildEpaySignString(
      {
        money: "29.00",
        pid: "1001",
        type: "alipay",
        out_trade_no: "ORDER-001"
      },
      MERCHANT_KEY
    );

    // Keys must appear in alphabetical order
    const keyOrder = signString
      .split("&")
      .map((pair) => pair.split("=")[0] ?? "");

    expect(keyOrder).toEqual(["money", "out_trade_no", "pid", "type"]);
  });

  it("appends the merchant key at the end (not as key=value)", () => {
    const signString = buildEpaySignString(
      { pid: "1001", money: "29.00" },
      MERCHANT_KEY
    );
    // signString = "money=29.00&pid=1001my-secret-key-123"
    expect(signString).toBe(`money=29.00&pid=1001${MERCHANT_KEY}`);
  });

  it("excludes empty, null, undefined, sign, and sign_type before building", () => {
    const signString = buildEpaySignString(
      {
        pid: "1001",
        money: "29.00",
        sign: "should-be-removed",
        sign_type: "MD5",
        name: "",
        extra: null
      },
      MERCHANT_KEY
    );
    expect(signString).toBe(`money=29.00&pid=1001${MERCHANT_KEY}`);
  });
});

describe("signEpayParams", () => {
  it("returns a 32-character lowercase MD5 hex string", () => {
    const sign = signEpayParams(
      { pid: "1001", money: "29.00" },
      MERCHANT_KEY
    );
    expect(sign).toMatch(/^[a-f0-9]{32}$/);
  });

  it("returns a stable MD5 for a known fixture", () => {
    // Known input → expected MD5 from standard tools.
    // signString = "money=29.00&pid=1001my-secret-key-123"
    // md5("money=29.00&pid=1001my-secret-key-123") = "ddc7e56b5882b71911c7d0feb2c20a38"
    const sign = signEpayParams(
      { pid: "1001", money: "29.00" },
      MERCHANT_KEY
    );
    // md5("money=29.00&pid=1001my-secret-key-123")
    expect(sign).toBe("890b02394b100867fe066e7661726b82");
  });

  it("produces different signs for different params", () => {
    const sign1 = signEpayParams(
      { pid: "1001", money: "29.00" },
      MERCHANT_KEY
    );
    const sign2 = signEpayParams(
      { pid: "1002", money: "29.00" },
      MERCHANT_KEY
    );
    expect(sign1).not.toBe(sign2);
  });

  it("produces different signs for different merchant keys", () => {
    const sign1 = signEpayParams(
      { pid: "1001", money: "29.00" },
      "key-a"
    );
    const sign2 = signEpayParams(
      { pid: "1001", money: "29.00" },
      "key-b"
    );
    expect(sign1).not.toBe(sign2);
  });
});

describe("verifyEpaySignature", () => {
  it("accepts a valid signature", () => {
    const params = { pid: "1001", money: "29.00", out_trade_no: "ORDER-001" };
    const sign = signEpayParams(params, MERCHANT_KEY);

    // Pass the sign as part of params — verify should strip it and recompute
    expect(
      verifyEpaySignature({ ...params, sign, sign_type: "MD5" }, MERCHANT_KEY, sign)
    ).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const params = { pid: "1001", money: "29.00" };
    expect(
      verifyEpaySignature(params, MERCHANT_KEY, "invalid-sign-hash-here")
    ).toBe(false);
  });

  it("rejects a signature for a different merchant key", () => {
    const params = { pid: "1001", money: "29.00" };
    const sign = signEpayParams(params, "correct-key");
    expect(verifyEpaySignature(params, "wrong-key", sign)).toBe(false);
  });
});

describe("EPay notify parsing and payment types", () => {
  const validNotify = {
    pid: "1001",
    trade_no: "provider-trade-1",
    out_trade_no: "order-1",
    type: "alipay",
    name: "Starter",
    money: "29.00",
    trade_status: "TRADE_SUCCESS",
    sign: "signed",
    sign_type: "MD5"
  };

  it("accepts a complete callback without changing its exact fields", () => {
    expect(parseEpayNotifyParams(validNotify)).toEqual(validNotify);
  });

  it("rejects a missing payment type", () => {
    const { type: _type, ...withoutType } = validNotify;
    expect(parseEpayNotifyParams(withoutType)).toBeNull();
  });

  it("rejects duplicate fields and preserves whitespace for exact validation", () => {
    expect(
      parseEpayNotifyParams({ ...validNotify, type: ["alipay", "wxpay"] })
    ).toBeNull();
    expect(
      parseEpayNotifyParams({ ...validNotify, type: " alipay " })
    ).toMatchObject({ type: " alipay " });
  });

  it("accepts only the configured EPay payment type values", () => {
    expect(isEpayPaymentType("alipay")).toBe(true);
    expect(isEpayPaymentType("wxpay")).toBe(true);
    expect(isEpayPaymentType("ALIPAY")).toBe(false);
    expect(isEpayPaymentType("bank")).toBe(false);
  });
});

describe("EPay existing-session recovery", () => {
  const recoveryEnv = {
    EPAY_RECOVERY_QUERY_ORIGIN: "https://provider.example.com"
  };
  const recoveryConfig = {
    pid: "1001",
    notifyUrl: "https://mysite.example.com/api/epay/notify",
    returnUrl: "https://mysite.example.com/payment/return"
  };

  function providerPayload(overrides: Record<string, unknown> = {}) {
    return {
      code: 200,
      msg: "ok",
      data: {
        id: 1001,
        type: "alipay",
        trade_no: "Y123",
        out_trade_no: "order_existing",
        name: "Starter",
        money: "29.00",
        status: 0,
        notify_url: recoveryConfig.notifyUrl,
        return_url: recoveryConfig.returnUrl,
        ...overrides
      }
    };
  }

  function recover(
    fetchImpl: typeof fetch,
    overrides: Partial<{
      env: Partial<NodeJS.ProcessEnv>;
      paymentTradeNo: string;
      paymentType: "alipay" | "wxpay";
      amountCents: number;
    }> = {}
  ) {
    return recoverExistingEpayPaymentSession({
      env: overrides.env ?? recoveryEnv,
      config: recoveryConfig,
      paymentTradeNo: overrides.paymentTradeNo ?? "order_existing",
      paymentType: overrides.paymentType ?? "alipay",
      amountCents: overrides.amountCents ?? 2900,
      fetchImpl
    });
  }

  it("accepts only a trimmed, absolute, HTTPS origin with origin-only semantics", () => {
    expect(
      resolveEpayRecoveryQueryOrigin({
        EPAY_RECOVERY_QUERY_ORIGIN: "  https://provider.example.com  "
      })
    ).toBe("https://provider.example.com");

    for (const value of [
      "",
      "provider.example.com",
      "http://provider.example.com",
      "https://user:pass@provider.example.com",
      "https://provider.example.com/api",
      "https://provider.example.com?target=other",
      "https://provider.example.com#fragment"
    ]) {
      expect(
        resolveEpayRecoveryQueryOrigin({
          EPAY_RECOVERY_QUERY_ORIGIN: value
        })
      ).toBeNull();
    }
  });

  it("posts the exact lookup contract and returns a safely encoded console URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(providerPayload({ trade_no: "Y 123/+" })), {
        status: 200
      })
    );

    await expect(recover(fetchImpl)).resolves.toEqual({
      status: "UNPAID",
      paymentUrl:
        "https://provider.example.com/Pay/console?trade_no=Y+123%2F%2B"
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [target, init] = fetchImpl.mock.calls[0]!;
    expect(String(target)).toBe("https://provider.example.com/api/findorder");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "order_no=order_existing&type=2",
      credentials: "omit",
      redirect: "manual"
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports Provider-paid state without producing a payment URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(providerPayload({ status: 1 })), {
        status: 200
      })
    );

    await expect(recover(fetchImpl)).resolves.toEqual({ status: "PAID" });
  });

  it.each([
    ["pid", { id: 1002 }],
    ["out_trade_no", { out_trade_no: "order_other" }],
    ["money", { money: "29.01" }],
    ["type", { type: "wxpay" }],
    ["notify_url", { notify_url: "https://other.example/notify" }],
    ["return_url", { return_url: "https://other.example/return" }]
  ])("fails closed on %s mismatch", async (_field, override) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(providerPayload(override)), { status: 200 })
    );

    await expect(recover(fetchImpl)).rejects.toThrow(
      "EPAY_RECOVERY_UNAVAILABLE"
    );
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["control character", "Y123\nnext"],
    ["oversized", "Y".repeat(EPAY_RECOVERY_TRADE_NO_MAX_LENGTH + 1)]
  ])("fails closed on an %s Provider trade number", async (_name, tradeNo) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify(providerPayload({ trade_no: tradeNo })),
        { status: 200 }
      )
    );

    await expect(recover(fetchImpl)).rejects.toThrow(
      "EPAY_RECOVERY_UNAVAILABLE"
    );
  });

  it("fails closed on an unknown Provider status", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(providerPayload({ status: 2 })), {
        status: 200
      })
    );

    await expect(recover(fetchImpl)).rejects.toThrow(
      "EPAY_RECOVERY_UNAVAILABLE"
    );
  });

  it.each([
    {
      name: "network failure",
      response: () => Promise.reject(new Error("network unavailable"))
    },
    {
      name: "non-JSON response",
      response: () => Promise.resolve(new Response("not json", { status: 200 }))
    },
    {
      name: "non-2xx response",
      response: () => Promise.resolve(new Response("unavailable", { status: 503 }))
    },
    {
      name: "redirect response",
      response: () =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://other.example/order" }
          })
        )
    },
    {
      name: "Provider failure code",
      response: () =>
        Promise.resolve(
          new Response(JSON.stringify({ code: 500, data: null }), {
            status: 200
          })
        )
    },
    {
      name: "Provider order not found",
      response: () =>
        Promise.resolve(
          new Response(JSON.stringify({ code: 200, data: null }), {
            status: 200
          })
        )
    }
  ])("fails closed on $name", async ({ response }) => {
    const fetchImpl = vi.fn<typeof fetch>(response);

    await expect(recover(fetchImpl)).rejects.toThrow(
      "EPAY_RECOVERY_UNAVAILABLE"
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails before fetch when the recovery origin is missing or invalid", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      recover(fetchImpl, { env: {} })
    ).rejects.toThrow("EPAY_RECOVERY_UNAVAILABLE");
    await expect(
      recover(fetchImpl, {
        env: { EPAY_RECOVERY_QUERY_ORIGIN: "http://provider.example.com" }
      })
    ).rejects.toThrow("EPAY_RECOVERY_UNAVAILABLE");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts and fails closed at the bounded lookup timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>((_target, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        );
      })
    );

    const pendingRecovery = recover(fetchImpl);
    const rejection = expect(pendingRecovery).rejects.toThrow(
      "EPAY_RECOVERY_UNAVAILABLE"
    );
    await vi.advanceTimersByTimeAsync(EPAY_RECOVERY_QUERY_TIMEOUT_MS);
    await rejection;
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
