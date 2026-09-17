export interface PublicEpayStatus {
  enabled: boolean;
  misconfigured: boolean;
  paymentMethods?: string[];
}

export function getPricingPaymentNoticeKey(
  status: PublicEpayStatus | null
): "pricing.onlineNotice" | "pricing.manualNotice" {
  return status?.enabled && !status.misconfigured
    ? "pricing.onlineNotice"
    : "pricing.manualNotice";
}
