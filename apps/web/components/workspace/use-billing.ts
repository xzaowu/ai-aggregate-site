"use client";

import type {
  EpayPaymentResponse,
  OrderSummary,
  PlanSummary
} from "@ai-aggregate/shared";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import { apiUrl } from "../../lib/site-config";
import type { PublicEpayStatus } from "./payment-notice";
import {
  normalizePaymentMethods,
  resolvePendingOrderPaymentMethod,
  type PaymentMethod
} from "./payment-methods";
import { findPendingOrderForPlan } from "./order-list";

type BillingLoadState = "loading" | "ready" | "error";

type UseBillingOptions = {
  readonly token: string | null;
  readonly initialPlans?: readonly PlanSummary[];
  readonly initialOrders?: readonly OrderSummary[];
  readonly initialPaymentStatus?: PublicEpayStatus | null;
  readonly onOrderCreated?: () => void;
  readonly onRequireLogin?: () => void;
};

export function useBilling({
  token,
  initialPlans,
  initialOrders,
  initialPaymentStatus = null,
  onOrderCreated,
  onRequireLogin
}: UseBillingOptions) {
  const router = useRouter();
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<BillingLoadState>(
    initialPlans ? "ready" : "loading"
  );
  const [plans, setPlans] = useState<readonly PlanSummary[]>(initialPlans ?? []);
  const [orders, setOrders] = useState<OrderSummary[]>(() => [
    ...(initialOrders ?? [])
  ]);
  const [paymentStatus, setPaymentStatus] = useState<PublicEpayStatus | null>(
    initialPaymentStatus
  );
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethod>("alipay");
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const cancelOrderInFlightRef = useRef<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadBilling(): Promise<void> {
      try {
        const [plansResponse, paymentStatusResponse, ordersResponse] =
          await Promise.all([
            fetch(apiUrl("/plans")),
            fetch(apiUrl("/payments/epay/status")),
            token
              ? fetch(apiUrl("/orders/me"), {
                  headers: { Authorization: `Bearer ${token}` }
                })
              : Promise.resolve(null)
          ]);

        if (!plansResponse.ok) {
          throw new Error(t("pricing.loadFailed"));
        }

        const plansData = (await plansResponse.json()) as {
          plans: PlanSummary[];
        };
        const nextPaymentStatus = paymentStatusResponse.ok
          ? ((await paymentStatusResponse.json()) as PublicEpayStatus)
          : null;
        const ordersData = ordersResponse?.ok
          ? ((await ordersResponse.json()) as { orders: OrderSummary[] })
          : null;

        if (!isMounted) return;
        setPlans(plansData.plans);
        setPaymentStatus(nextPaymentStatus);
        if (ordersData) {
          setOrders(ordersData.orders);
        }
        setLoadState("ready");
      } catch (caught) {
        if (!isMounted) return;
        setError(
          caught instanceof Error ? caught.message : t("pricing.loadFailed")
        );
        setLoadState("error");
      }
    }

    void loadBilling();
    return () => {
      isMounted = false;
    };
  }, [t, token]);

  const paymentMethods = useMemo(
    () => normalizePaymentMethods(paymentStatus?.paymentMethods),
    [paymentStatus?.paymentMethods]
  );

  useEffect(() => {
    if (!paymentMethods.includes(selectedPaymentMethod)) {
      setSelectedPaymentMethod(paymentMethods[0] ?? "alipay");
    }
  }, [paymentMethods, selectedPaymentMethod]);

  async function payNow(
    orderId: string,
    paymentMethod: PaymentMethod
  ): Promise<void> {
    if (!token) {
      onRequireLogin?.();
      return;
    }

    const response = await fetch(apiUrl(`/orders/${orderId}/pay`), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ paymentType: paymentMethod })
    });

    if (!response.ok) {
      const responseText = await response.text();
      if (responseText.includes("disabled")) {
        throw new Error(t("payment.disabled"));
      }
      if (responseText.includes("not fully configured")) {
        throw new Error(t("payment.misconfigured"));
      }
      throw new Error(t("payment.redirectFailed"));
    }

    const data = (await response.json()) as EpayPaymentResponse;
    if (!data.paymentUrl) {
      throw new Error(t("payment.redirectFailed"));
    }

    window.location.href = data.paymentUrl;
  }

  async function resumePayment(order: OrderSummary): Promise<void> {
    if (!token) {
      onRequireLogin?.();
      return;
    }
    if (cancelOrderInFlightRef.current === order.id) return;

    setProcessingPlanId(order.planId);
    setMessage(null);
    setError(null);

    try {
      if (!paymentStatus?.enabled) {
        setError(t("payment.disabled"));
        return;
      }

      const paymentMethod = resolvePendingOrderPaymentMethod(
        order.paymentType,
        paymentMethods,
        selectedPaymentMethod
      );

      if (!paymentMethod) {
        setError(t("billing.pendingPaymentMethodUnavailable"));
        return;
      }

      await payNow(order.id, paymentMethod);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("payment.redirectFailed")
      );
    } finally {
      setProcessingPlanId(null);
    }
  }

  async function createOrder(planId: string): Promise<OrderSummary> {
    if (!token) {
      onRequireLogin?.();
      throw new Error(t("billing.loginRequired"));
    }

    const response = await fetch(apiUrl("/orders"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ planId })
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        responseText.includes("not available")
          ? t("pricing.planUnavailable")
          : t("pricing.createOrderFailedFriendly")
      );
    }

    const data = (await response.json()) as { order: OrderSummary };
    return data.order;
  }

  async function cancelPendingOrder(order: OrderSummary): Promise<boolean> {
    if (!token) {
      onRequireLogin?.();
      return false;
    }
    if (
      order.status !== "PENDING" ||
      cancelOrderInFlightRef.current !== null
    ) {
      return false;
    }

    cancelOrderInFlightRef.current = order.id;
    setCancellingOrderId(order.id);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(
        apiUrl(`/orders/${encodeURIComponent(order.id)}/cancel`),
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (!response.ok) throw new Error("order cancellation failed");

      const data = (await response.json()) as { order?: OrderSummary };
      if (data.order?.id !== order.id || data.order.status !== "CANCELLED") {
        throw new Error("invalid order cancellation response");
      }
      const cancelledOrder = data.order;

      setOrders((current) =>
        current.map((currentOrder) =>
          currentOrder.id === order.id ? cancelledOrder : currentOrder
        )
      );
      setMessage(t("account.orderCancelled"));
      return true;
    } catch {
      setError(t("account.orderCancelFailed"));
      return false;
    } finally {
      cancelOrderInFlightRef.current = null;
      setCancellingOrderId(null);
    }
  }

  async function purchase(planId: string): Promise<void> {
    if (!token) {
      onRequireLogin?.();
      return;
    }

    const pendingOrder = findPendingOrderForPlan(orders, planId);
    if (pendingOrder) {
      await resumePayment(pendingOrder);
      return;
    }

    setProcessingPlanId(planId);
    setMessage(null);
    setError(null);

    try {
      const order = await createOrder(planId);
      setOrders((current) => [order, ...current]);
      onOrderCreated?.();

      if (paymentStatus?.enabled) {
        await payNow(order.id, selectedPaymentMethod);
      } else {
        setMessage(t("pricing.orderCreatedMessage"));
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("pricing.createOrderFailedFriendly")
      );
    } finally {
      setProcessingPlanId(null);
    }
  }

  return {
    loadState,
    plans,
    orders,
    paymentStatus,
    paymentMethods,
    selectedPaymentMethod,
    setSelectedPaymentMethod,
    processingPlanId,
    cancellingOrderId,
    message,
    error,
    resumePayment,
    cancelPendingOrder,
    purchase
  };
}
