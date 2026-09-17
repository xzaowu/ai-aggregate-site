export type PaymentMethod = "alipay" | "wxpay";

export interface PaymentMethodLabels {
  alipay: string;
  wxpay: string;
  onlinePayment: string;
  empty: string;
}

const supportedPaymentMethods: PaymentMethod[] = ["alipay", "wxpay"];
const defaultPaymentMethodLabels: PaymentMethodLabels = {
  alipay: "支付宝",
  wxpay: "微信支付",
  onlinePayment: "在线支付",
  empty: "-"
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return (
    typeof value === "string" &&
    supportedPaymentMethods.includes(value as PaymentMethod)
  );
}

export function normalizePaymentMethods(value: unknown): PaymentMethod[] {
  if (!Array.isArray(value)) {
    return ["alipay"];
  }

  const methods = Array.from(new Set(value.filter(isPaymentMethod)));

  if (methods.length === 0) {
    return ["alipay"];
  }

  return methods.includes("alipay") ? methods : ["alipay", ...methods];
}

export function shouldShowPaymentMethodOptions(methods: PaymentMethod[]): boolean {
  return methods.length > 1;
}

export function getPaymentMethodLabel(
  method: PaymentMethod,
  labels: PaymentMethodLabels = defaultPaymentMethodLabels
): string {
  return labels[method];
}

export function getOrderPaymentMethodLabel(
  paymentType: string | null | undefined,
  paymentProvider: string | null | undefined,
  labels: PaymentMethodLabels = defaultPaymentMethodLabels
): string {
  if (isPaymentMethod(paymentType)) {
    return getPaymentMethodLabel(paymentType, labels);
  }

  return paymentProvider === "epay" ? labels.onlinePayment : labels.empty;
}

export function resolvePendingOrderPaymentMethod(
  paymentType: string | null | undefined,
  enabledMethods: readonly PaymentMethod[],
  selectedMethod: PaymentMethod
): PaymentMethod | null {
  if (paymentType === null || paymentType === undefined || paymentType.trim() === "") {
    return enabledMethods.includes(selectedMethod) ? selectedMethod : null;
  }

  return isPaymentMethod(paymentType) && enabledMethods.includes(paymentType)
    ? paymentType
    : null;
}
