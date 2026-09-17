import type { PaymentAttempt, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { createProviderTradeIdentityHash } from "../src/payments/payment-attempt";
import { createPrismaUserStore } from "../src/store";

function reviewAttempt(
  overrides: Partial<PaymentAttempt> = {}
): PaymentAttempt {
  const providerTradeNo = overrides.providerTradeNo ?? "Y-REVIEW-STORE";
  const provider = overrides.provider ?? "epay";
  const providerMerchantRef = overrides.providerMerchantRef ?? "merchant-store";

  return {
    id: "attempt-review-store",
    orderId: "order-review-store",
    ordinal: 1,
    provider,
    providerMerchantRef,
    paymentType: "wxpay",
    merchantTradeNo: "order_review_store",
    providerTradeNo,
    providerTradeIdentityHash: Uint8Array.from(
      createProviderTradeIdentityHash({
        provider,
        providerMerchantRef,
        providerTradeNo
      })
    ),
    status: "PAID_REQUIRES_REVIEW",
    paidAt: new Date("2030-01-02T03:04:05.000Z"),
    createdAt: new Date("2030-01-02T03:00:00.000Z"),
    updatedAt: new Date("2030-01-02T03:04:05.000Z"),
    ...overrides
  };
}

function reviewOrder() {
  return {
    id: "order-review-store",
    userId: "user-review-store",
    planId: "plan-review-store",
    amount: 5900,
    credits: 500,
    status: "CANCELLED" as const,
    paymentProvider: "epay",
    paymentType: "wxpay",
    paymentTradeNo: "order_review_store",
    providerTradeNo: null,
    paymentUrl: "https://pay.example/secret-session-url",
    paidAt: null,
    createdAt: new Date("2030-01-02T02:00:00.000Z"),
    updatedAt: new Date("2030-01-02T03:04:05.000Z"),
    plan: { name: "Review Plan" },
    user: { email: "review-store@example.com" },
    paymentAttempts: [reviewAttempt()]
  };
}

describe("Prisma Admin payment review projection", () => {
  it("combines existing filters with strict REVIEW existence and returns only safe Attempt fields", async () => {
    const findMany = vi.fn().mockResolvedValue([reviewOrder()]);
    const store = createPrismaUserStore({
      order: { findMany }
    } as unknown as PrismaClient);

    const orders = await store.listAdminOrders({
      q: "review-store",
      status: "CANCELLED",
      paymentType: "wxpay",
      review: true,
      limit: 25
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "CANCELLED",
        paymentType: "wxpay",
        paymentAttempts: {
          some: { status: "PAID_REQUIRES_REVIEW" }
        },
        OR: [
          { id: { contains: "review-store" } },
          { plan: { is: { name: { contains: "review-store" } } } },
          { user: { is: { email: { contains: "review-store" } } } },
          { paymentTradeNo: { contains: "review-store" } },
          { providerTradeNo: { contains: "review-store" } }
        ]
      },
      include: {
        plan: true,
        user: true,
        paymentAttempts: {
          where: { status: "PAID_REQUIRES_REVIEW" },
          orderBy: [{ ordinal: "asc" }, { createdAt: "asc" }]
        }
      },
      orderBy: { createdAt: "desc" },
      take: 25
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]).not.toHaveProperty("paymentUrl");
    expect(orders[0]?.reviewAttempts).toEqual([
      {
        id: "attempt-review-store",
        orderId: "order-review-store",
        ordinal: 1,
        status: "PAID_REQUIRES_REVIEW",
        provider: "epay",
        paymentType: "wxpay",
        merchantTradeNo: "order_review_store",
        providerTradeNo: "Y-REVIEW-STORE",
        paidAt: "2030-01-02T03:04:05.000Z",
        createdAt: "2030-01-02T03:00:00.000Z"
      }
    ]);
    expect(orders[0]?.reviewAttempts[0]).not.toHaveProperty(
      "providerMerchantRef"
    );
    expect(orders[0]?.reviewAttempts[0]).not.toHaveProperty(
      "providerTradeIdentityHash"
    );
  });

  it("counts Orders with REVIEW Attempts instead of counting Attempt rows", async () => {
    const count = vi.fn().mockResolvedValue(1);
    const store = createPrismaUserStore({
      order: { count }
    } as unknown as PrismaClient);

    await expect(
      store.countAdminOrdersRequiringPaymentReview()
    ).resolves.toBe(1);
    expect(count).toHaveBeenCalledWith({
      where: {
        paymentAttempts: {
          some: { status: "PAID_REQUIRES_REVIEW" }
        }
      }
    });
  });
});
