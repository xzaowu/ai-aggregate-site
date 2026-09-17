import {
  convertEpayMoneyToCents,
  type EpayConfig,
  type EpayPaymentType
} from "./epay";

export const EPAY_RECOVERY_QUERY_TIMEOUT_MS = 5_000;
export const EPAY_RECOVERY_TRADE_NO_MAX_LENGTH = 191;

export type EpayRecoveryResult =
  | {
      status: "UNPAID";
      paymentUrl: string;
    }
  | {
      status: "PAID";
    };

function recoveryUnavailable(): Error {
  return new Error("EPAY_RECOVERY_UNAVAILABLE");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveEpayRecoveryQueryOrigin(
  env: Partial<NodeJS.ProcessEnv>
): string | null {
  const configuredOrigin = (env.EPAY_RECOVERY_QUERY_ORIGIN ?? "").trim();

  if (!configuredOrigin) {
    return null;
  }

  try {
    const parsed = new URL(configuredOrigin);

    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

function isValidProviderTradeNo(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= EPAY_RECOVERY_TRADE_NO_MAX_LENGTH &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

function validateProviderOrder(
  payload: unknown,
  input: {
    config: Pick<EpayConfig, "pid" | "notifyUrl" | "returnUrl">;
    paymentTradeNo: string;
    paymentType: EpayPaymentType;
    amountCents: number;
  }
): { status: 0 | 1; tradeNo: string } {
  if (!isRecord(payload) || payload.code !== 200 || !isRecord(payload.data)) {
    throw recoveryUnavailable();
  }

  const data = payload.data;
  const providerMoney =
    typeof data.money === "string"
      ? convertEpayMoneyToCents(data.money)
      : null;

  if (
    String(data.id) !== input.config.pid ||
    data.out_trade_no !== input.paymentTradeNo ||
    providerMoney === null ||
    providerMoney !== input.amountCents ||
    data.type !== input.paymentType ||
    data.notify_url !== input.config.notifyUrl ||
    data.return_url !== input.config.returnUrl ||
    !isValidProviderTradeNo(data.trade_no) ||
    (data.status !== 0 && data.status !== 1)
  ) {
    throw recoveryUnavailable();
  }

  return {
    status: data.status,
    tradeNo: data.trade_no
  };
}

export async function recoverExistingEpayPaymentSession(input: {
  env: Partial<NodeJS.ProcessEnv>;
  config: Pick<EpayConfig, "pid" | "notifyUrl" | "returnUrl">;
  paymentTradeNo: string;
  paymentType: EpayPaymentType;
  amountCents: number;
  fetchImpl: typeof fetch;
}): Promise<EpayRecoveryResult> {
  const trustedOrigin = resolveEpayRecoveryQueryOrigin(input.env);

  if (
    trustedOrigin === null ||
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents < 0
  ) {
    throw recoveryUnavailable();
  }

  const lookupUrl = new URL("/api/findorder", trustedOrigin);
  const body = new URLSearchParams();
  body.set("order_no", input.paymentTradeNo);
  body.set("type", "2");

  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const operation = (async (): Promise<EpayRecoveryResult> => {
    const response = await input.fetchImpl(lookupUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString(),
      credentials: "omit",
      redirect: "manual",
      signal: controller.signal
    });

    if (!response.ok) {
      throw recoveryUnavailable();
    }

    const providerOrder = validateProviderOrder(await response.json(), input);

    if (providerOrder.status === 1) {
      return { status: "PAID" };
    }

    const paymentUrl = new URL("/Pay/console", trustedOrigin);
    paymentUrl.searchParams.set("trade_no", providerOrder.tradeNo);

    return {
      status: "UNPAID",
      paymentUrl: paymentUrl.href
    };
  })();
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(recoveryUnavailable());
    }, EPAY_RECOVERY_QUERY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operation, timeout]);
  } catch {
    throw recoveryUnavailable();
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}
