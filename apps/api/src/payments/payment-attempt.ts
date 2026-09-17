import { createHash } from "node:crypto";

export const INITIAL_PAYMENT_ATTEMPT_ORDINAL = 1;

const PAYMENT_ATTEMPT_ID_MAX_LENGTH = 191;
const PAYMENT_ATTEMPT_ORDINAL_MAX = 2_147_483_647;
const PAYMENT_ATTEMPT_PROVIDER_MAX_LENGTH = 20;
const PAYMENT_ATTEMPT_PROVIDER_MERCHANT_REF_MAX_LENGTH = 191;
const PAYMENT_ATTEMPT_PAYMENT_TYPE_MAX_LENGTH = 20;
const PAYMENT_ATTEMPT_MERCHANT_TRADE_NO_MAX_LENGTH = 191;
const PAYMENT_ATTEMPT_PROVIDER_TRADE_NO_MAX_LENGTH = 191;
const PAYMENT_ATTEMPT_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f]/u;
const PROVIDER_TRADE_IDENTITY_HASH_DOMAIN =
  "payment-provider-trade-identity-v1";

export interface ProviderTradeIdentityInput {
  provider: string;
  providerMerchantRef: string;
  providerTradeNo: string;
}

export interface PaymentAttemptStoredIdentityInput {
  id: string;
  orderId: string;
  ordinal: number;
  provider: string;
  providerMerchantRef: string;
  paymentType: string;
  merchantTradeNo: string;
  providerTradeNo: string | null;
}

export interface InitialPaymentAttemptIdentityInput {
  orderId: string;
  provider: string;
  providerMerchantRef: string;
  paymentType: string;
  merchantTradeNo: string;
}

export interface PaymentAttemptCallbackIdentityInput {
  provider: string;
  providerMerchantRef: string;
  paymentType: string;
  merchantTradeNo: string;
  providerTradeNo: string;
}

function validateIdentityText(
  value: unknown,
  maxLength: number,
  errorCode: string
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    Array.from(value).length > maxLength ||
    PAYMENT_ATTEMPT_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new TypeError(errorCode);
  }

  return value;
}

export function validatePaymentAttemptMerchantTradeNo(
  merchantTradeNo: unknown
): string {
  return validateIdentityText(
    merchantTradeNo,
    PAYMENT_ATTEMPT_MERCHANT_TRADE_NO_MAX_LENGTH,
    "INVALID_PAYMENT_ATTEMPT_MERCHANT_TRADE_NO"
  );
}

export function validatePaymentAttemptOrderId(orderId: unknown): string {
  return validateIdentityText(
    orderId,
    PAYMENT_ATTEMPT_ID_MAX_LENGTH,
    "INVALID_PAYMENT_ATTEMPT_ORDER_ID"
  );
}

export function validatePaymentAttemptOrdinal(ordinal: unknown): number {
  if (
    typeof ordinal !== "number" ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < INITIAL_PAYMENT_ATTEMPT_ORDINAL ||
    ordinal > PAYMENT_ATTEMPT_ORDINAL_MAX
  ) {
    throw new TypeError("INVALID_PAYMENT_ATTEMPT_ORDINAL");
  }

  return ordinal;
}

export function validatePaymentAttemptStoredIdentity(
  input: PaymentAttemptStoredIdentityInput
): PaymentAttemptStoredIdentityInput {
  return {
    id: validateIdentityText(
      input.id,
      PAYMENT_ATTEMPT_ID_MAX_LENGTH,
      "INVALID_PAYMENT_ATTEMPT_ID"
    ),
    orderId: validatePaymentAttemptOrderId(input.orderId),
    ordinal: validatePaymentAttemptOrdinal(input.ordinal),
    provider: validateIdentityText(
      input.provider,
      PAYMENT_ATTEMPT_PROVIDER_MAX_LENGTH,
      "INVALID_PAYMENT_ATTEMPT_PROVIDER"
    ),
    providerMerchantRef: validateIdentityText(
      input.providerMerchantRef,
      PAYMENT_ATTEMPT_PROVIDER_MERCHANT_REF_MAX_LENGTH,
      "INVALID_PAYMENT_ATTEMPT_PROVIDER_MERCHANT_REF"
    ),
    paymentType: validateIdentityText(
      input.paymentType,
      PAYMENT_ATTEMPT_PAYMENT_TYPE_MAX_LENGTH,
      "INVALID_PAYMENT_ATTEMPT_PAYMENT_TYPE"
    ),
    merchantTradeNo: validatePaymentAttemptMerchantTradeNo(
      input.merchantTradeNo
    ),
    providerTradeNo:
      input.providerTradeNo === null
        ? null
        : validateIdentityText(
            input.providerTradeNo,
            PAYMENT_ATTEMPT_PROVIDER_TRADE_NO_MAX_LENGTH,
            "INVALID_PAYMENT_ATTEMPT_PROVIDER_TRADE_NO"
          )
  };
}

export function validateInitialPaymentAttemptIdentity(
  input: InitialPaymentAttemptIdentityInput
): InitialPaymentAttemptIdentityInput {
  return {
    orderId: validatePaymentAttemptOrderId(input.orderId),
    provider: validateIdentityText(
      input.provider,
      PAYMENT_ATTEMPT_PROVIDER_MAX_LENGTH,
      "INVALID_PAYMENT_ATTEMPT_PROVIDER"
    ),
    providerMerchantRef: validateIdentityText(
      input.providerMerchantRef,
      PAYMENT_ATTEMPT_PROVIDER_MERCHANT_REF_MAX_LENGTH,
      "INVALID_PAYMENT_ATTEMPT_PROVIDER_MERCHANT_REF"
    ),
    paymentType: validateIdentityText(
      input.paymentType,
      PAYMENT_ATTEMPT_PAYMENT_TYPE_MAX_LENGTH,
      "INVALID_PAYMENT_ATTEMPT_PAYMENT_TYPE"
    ),
    merchantTradeNo: validatePaymentAttemptMerchantTradeNo(
      input.merchantTradeNo
    )
  };
}

export function validatePaymentAttemptCallbackIdentity(
  input: PaymentAttemptCallbackIdentityInput
): PaymentAttemptCallbackIdentityInput {
  return {
    provider: validateIdentityText(
      input.provider,
      PAYMENT_ATTEMPT_PROVIDER_MAX_LENGTH,
      "INVALID_PAYMENT_ATTEMPT_PROVIDER"
    ),
    providerMerchantRef: validateIdentityText(
      input.providerMerchantRef,
      PAYMENT_ATTEMPT_PROVIDER_MERCHANT_REF_MAX_LENGTH,
      "INVALID_PAYMENT_ATTEMPT_PROVIDER_MERCHANT_REF"
    ),
    paymentType: validateIdentityText(
      input.paymentType,
      PAYMENT_ATTEMPT_PAYMENT_TYPE_MAX_LENGTH,
      "INVALID_PAYMENT_ATTEMPT_PAYMENT_TYPE"
    ),
    merchantTradeNo: validatePaymentAttemptMerchantTradeNo(
      input.merchantTradeNo
    ),
    providerTradeNo: validateIdentityText(
      input.providerTradeNo,
      PAYMENT_ATTEMPT_PROVIDER_TRADE_NO_MAX_LENGTH,
      "INVALID_PAYMENT_ATTEMPT_PROVIDER_TRADE_NO"
    )
  };
}

export function createProviderTradeIdentityHash(
  input: ProviderTradeIdentityInput
): Buffer {
  const provider = validateIdentityText(
    input.provider,
    PAYMENT_ATTEMPT_PROVIDER_MAX_LENGTH,
    "INVALID_PAYMENT_ATTEMPT_PROVIDER"
  );
  const providerMerchantRef = validateIdentityText(
    input.providerMerchantRef,
    PAYMENT_ATTEMPT_PROVIDER_MERCHANT_REF_MAX_LENGTH,
    "INVALID_PAYMENT_ATTEMPT_PROVIDER_MERCHANT_REF"
  );
  const providerTradeNo = validateIdentityText(
    input.providerTradeNo,
    PAYMENT_ATTEMPT_PROVIDER_TRADE_NO_MAX_LENGTH,
    "INVALID_PAYMENT_ATTEMPT_PROVIDER_TRADE_NO"
  );
  const preimage = JSON.stringify([
    PROVIDER_TRADE_IDENTITY_HASH_DOMAIN,
    provider,
    providerMerchantRef,
    providerTradeNo
  ]);

  return createHash("sha256").update(preimage, "utf8").digest();
}
