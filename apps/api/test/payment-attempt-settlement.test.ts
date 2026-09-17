import type {
  AccountCreditEvent,
  OrderStatus,
  PaymentAttempt,
  PaymentAttemptStatus,
  Prisma,
  PrismaClient
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  createProviderTradeIdentityHash,
  INITIAL_PAYMENT_ATTEMPT_ORDINAL
} from "../src/payments/payment-attempt";
import {
  createPrismaUserStore,
  type MaterializeLegacyPaymentAttemptFromCallbackInput,
  type SettlePaymentAttemptFromCallbackInput
} from "../src/store";

type SettlementOrder = Prisma.OrderGetPayload<{
  include: { plan: true; user: true };
}>;

interface SettlementState {
  order: SettlementOrder;
  attempts: PaymentAttempt[];
  remainingCredits: number;
  creditEvents: AccountCreditEvent[];
}

interface SettlementFixtureOptions {
  attempts?: PaymentAttempt[];
  attemptCreateP2002?: {
    target: string | string[];
    mutateCommittedState(state: SettlementState): void;
  };
  failReceiptWriteWithP2002?: boolean;
  initialOrder?: SettlementOrder;
  mutateAuthoritativeStateOnProviderNormalizationCasMiss?: (
    state: SettlementState
  ) => void;
  mutateAuthoritativeStateOnReceiptCasMiss?: (
    state: SettlementState
  ) => void;
  remainingCredits?: number;
}

const paidAt = new Date("2030-08-26T12:00:00.000Z");

const callbackA: SettlePaymentAttemptFromCallbackInput = {
  provider: "epay",
  providerMerchantRef: "merchant-1",
  paymentType: "alipay",
  merchantTradeNo: "order_order-1",
  providerTradeNo: "Y-A",
  amountCents: 990,
  paidAt
};

const callbackB: SettlePaymentAttemptFromCallbackInput = {
  ...callbackA,
  merchantTradeNo: "order_order-1-attempt-2",
  providerTradeNo: "Y-B"
};

const legacyCallbackA: MaterializeLegacyPaymentAttemptFromCallbackInput = {
  ...callbackA,
  orderId: "order-1"
};

function paymentAttempt(
  overrides: Partial<PaymentAttempt> = {}
): PaymentAttempt {
  const provider = overrides.provider ?? callbackA.provider;
  const providerMerchantRef =
    overrides.providerMerchantRef ?? callbackA.providerMerchantRef;
  const providerTradeNo =
    "providerTradeNo" in overrides
      ? (overrides.providerTradeNo ?? null)
      : null;
  const providerTradeIdentityHash =
    "providerTradeIdentityHash" in overrides
      ? (overrides.providerTradeIdentityHash ?? null)
      : providerTradeNo === null
        ? null
        : Uint8Array.from(
            createProviderTradeIdentityHash({
              provider,
              providerMerchantRef,
              providerTradeNo
            })
          );

  return {
    id: "attempt-1",
    orderId: "order-1",
    ordinal: INITIAL_PAYMENT_ATTEMPT_ORDINAL,
    provider,
    providerMerchantRef,
    paymentType: callbackA.paymentType,
    merchantTradeNo: callbackA.merchantTradeNo,
    providerTradeNo,
    providerTradeIdentityHash,
    status: "ACTIVE",
    paidAt: providerTradeNo === null ? null : paidAt,
    createdAt: new Date("2030-08-26T11:00:00.000Z"),
    updatedAt: new Date("2030-08-26T11:00:00.000Z"),
    ...overrides
  };
}

function settlementOrder(
  overrides: Partial<SettlementOrder> = {}
): SettlementOrder {
  return {
    id: "order-1",
    userId: "user-1",
    planId: "plan-1",
    amount: callbackA.amountCents,
    credits: 100,
    status: "PENDING",
    paymentProvider: callbackA.provider,
    paymentType: callbackA.paymentType,
    paymentTradeNo: callbackA.merchantTradeNo,
    providerTradeNo: null,
    paymentUrl: "https://pay.example.test/submit.php",
    paidAt: null,
    createdAt: new Date("2030-08-26T11:00:00.000Z"),
    updatedAt: new Date("2030-08-26T11:00:00.000Z"),
    plan: {
      id: "plan-1",
      name: "Starter",
      slug: null,
      price: callbackA.amountCents,
      credits: 100,
      description: null,
      features: [],
      enabled: true,
      sortOrder: 1,
      highlighted: false,
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      updatedAt: new Date("2030-01-01T00:00:00.000Z")
    },
    user: {
      id: "user-1",
      email: "buyer@example.test",
      passwordHash: "hash",
      emailVerifiedAt: null,
      sessionVersion: 0,
      lastLoginAt: null,
      name: null,
      avatarUrl: null,
      avatarStorageObjectId: null,
      role: "USER",
      credits: 0,
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      updatedAt: new Date("2030-01-01T00:00:00.000Z")
    },
    ...overrides
  };
}

function cloneAttempt(attempt: PaymentAttempt): PaymentAttempt {
  return {
    ...attempt,
    providerTradeIdentityHash:
      attempt.providerTradeIdentityHash === null
        ? null
        : Uint8Array.from(attempt.providerTradeIdentityHash),
    paidAt: attempt.paidAt === null ? null : new Date(attempt.paidAt),
    createdAt: new Date(attempt.createdAt),
    updatedAt: new Date(attempt.updatedAt)
  };
}

function cloneOrder(order: SettlementOrder): SettlementOrder {
  return {
    ...order,
    paidAt: order.paidAt === null ? null : new Date(order.paidAt),
    createdAt: new Date(order.createdAt),
    updatedAt: new Date(order.updatedAt),
    plan: {
      ...order.plan,
      createdAt: new Date(order.plan.createdAt),
      updatedAt: new Date(order.plan.updatedAt)
    },
    user: {
      ...order.user,
      emailVerifiedAt:
        order.user.emailVerifiedAt === null
          ? null
          : new Date(order.user.emailVerifiedAt),
      lastLoginAt:
        order.user.lastLoginAt === null
          ? null
          : new Date(order.user.lastLoginAt),
      createdAt: new Date(order.user.createdAt),
      updatedAt: new Date(order.user.updatedAt)
    }
  };
}

function cloneState(state: SettlementState): SettlementState {
  return {
    order: cloneOrder(state.order),
    attempts: state.attempts.map(cloneAttempt),
    remainingCredits: state.remainingCredits,
    creditEvents: state.creditEvents.map((event) => ({
      ...event,
      createdAt: new Date(event.createdAt)
    }))
  };
}

function createSettlementFixture(options: SettlementFixtureOptions = {}) {
  let committed: SettlementState = {
    order: cloneOrder(options.initialOrder ?? settlementOrder()),
    attempts: (options.attempts ?? [paymentAttempt()]).map(cloneAttempt),
    remainingCredits: options.remainingCredits ?? 20,
    creditEvents: []
  };
  let transactionTail = Promise.resolve();
  let attemptCreateP2002Injected = false;
  let providerNormalizationCasMissInjected = false;
  let receiptCasMissInjected = false;
  const attemptCreateAttempts = vi.fn();
  const receiptWriteAttempts = vi.fn();
  const financialEventStaged = vi.fn();

  const transaction = vi.fn(
    async (
      operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
      transactionOptions?: { isolationLevel?: string }
    ) => {
      let release!: () => void;
      const previous = transactionTail;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;

      const staged = cloneState(committed);
      let rawQueryCount = 0;
      const tx = {
        paymentAttempt: {
          findUnique: vi.fn(
            async (args: {
              where:
                | { merchantTradeNo: string }
                | { orderId_ordinal: { orderId: string; ordinal: number } };
            }) => {
              if ("merchantTradeNo" in args.where) {
                const merchantTradeNo = args.where.merchantTradeNo;
                return (
                  staged.attempts.find(
                    (attempt) =>
                      attempt.merchantTradeNo === merchantTradeNo
                  ) ?? null
                );
              }
              const orderSlot = args.where.orderId_ordinal;
              return (
                staged.attempts.find(
                  (attempt) =>
                    attempt.orderId === orderSlot.orderId &&
                    attempt.ordinal === orderSlot.ordinal
                ) ?? null
              );
            }
          ),
          create: vi.fn(
            async (args: {
              data: {
                orderId: string;
                ordinal: number;
                provider: string;
                providerMerchantRef: string;
                paymentType: string;
                merchantTradeNo: string;
                providerTradeNo: null;
                providerTradeIdentityHash: null;
                status: PaymentAttemptStatus;
                paidAt: null;
              };
            }) => {
              attemptCreateAttempts();
              if (
                options.attemptCreateP2002 &&
                !attemptCreateP2002Injected
              ) {
                attemptCreateP2002Injected = true;
                const concurrentWinner = cloneState(committed);
                options.attemptCreateP2002.mutateCommittedState(
                  concurrentWinner
                );
                committed = concurrentWinner;
                throw {
                  code: "P2002",
                  meta: { target: options.attemptCreateP2002.target }
                };
              }

              if (
                staged.attempts.some(
                  (attempt) =>
                    attempt.merchantTradeNo === args.data.merchantTradeNo
                )
              ) {
                throw {
                  code: "P2002",
                  meta: {
                    target: "PaymentAttempt_merchantTradeNo_key"
                  }
                };
              }
              if (
                staged.attempts.some(
                  (attempt) =>
                    attempt.orderId === args.data.orderId &&
                    attempt.ordinal === args.data.ordinal
                )
              ) {
                throw {
                  code: "P2002",
                  meta: { target: "PaymentAttempt_orderId_ordinal_key" }
                };
              }

              const createdAt = new Date("2030-08-26T12:00:00.000Z");
              const attempt: PaymentAttempt = {
                id: `attempt-${staged.attempts.length + 1}`,
                ...args.data,
                createdAt,
                updatedAt: createdAt
              };
              staged.attempts.push(attempt);
              return attempt;
            }
          ),
          updateMany: vi.fn(
            async (args: {
              where: {
                id: string;
                orderId: string;
                provider: string;
                providerMerchantRef: string;
                paymentType: string;
                merchantTradeNo: string;
                status: PaymentAttemptStatus;
                providerTradeNo: null;
                providerTradeIdentityHash: null;
                paidAt: null;
              };
              data: {
                providerTradeNo: string;
                providerTradeIdentityHash: Uint8Array;
                paidAt: Date;
                status: PaymentAttemptStatus;
              };
            }) => {
              receiptWriteAttempts();
              if (
                options.mutateAuthoritativeStateOnReceiptCasMiss &&
                !receiptCasMissInjected
              ) {
                receiptCasMissInjected = true;
                options.mutateAuthoritativeStateOnReceiptCasMiss(staged);
                return { count: 0 };
              }
              if (options.failReceiptWriteWithP2002) {
                throw {
                  code: "P2002",
                  meta: {
                    target:
                      "PaymentAttempt_providerTradeIdentityHash_key"
                  }
                };
              }

              const index = staged.attempts.findIndex(
                (attempt) =>
                  attempt.id === args.where.id &&
                  attempt.orderId === args.where.orderId &&
                  attempt.provider === args.where.provider &&
                  attempt.providerMerchantRef ===
                    args.where.providerMerchantRef &&
                  attempt.paymentType === args.where.paymentType &&
                  attempt.merchantTradeNo === args.where.merchantTradeNo &&
                  attempt.status === args.where.status &&
                  attempt.providerTradeNo === null &&
                  attempt.providerTradeIdentityHash === null &&
                  attempt.paidAt === null
              );
              if (index === -1) {
                return { count: 0 };
              }

              const nextHash = Buffer.from(
                args.data.providerTradeIdentityHash
              ).toString("hex");
              if (
                staged.attempts.some(
                  (attempt, candidateIndex) =>
                    candidateIndex !== index &&
                    attempt.providerTradeIdentityHash !== null &&
                    Buffer.from(attempt.providerTradeIdentityHash).toString(
                      "hex"
                    ) === nextHash
                )
              ) {
                throw {
                  code: "P2002",
                  meta: {
                    target:
                      "PaymentAttempt_providerTradeIdentityHash_key"
                  }
                };
              }

              const current = staged.attempts[index];
              if (!current) {
                return { count: 0 };
              }
              staged.attempts[index] = {
                ...current,
                providerTradeNo: args.data.providerTradeNo,
                providerTradeIdentityHash: Uint8Array.from(
                  args.data.providerTradeIdentityHash
                ),
                paidAt: new Date(args.data.paidAt),
                status: args.data.status,
                updatedAt: new Date(args.data.paidAt)
              };
              return { count: 1 };
            }
          )
        },
        order: {
          findUnique: vi.fn(async () => staged.order),
          updateMany: vi.fn(
            async (args: {
              where: {
                id: string;
                status?: OrderStatus;
                paymentProvider?: null;
                paymentType?: string;
                paymentTradeNo?: string;
                amount?: number;
              };
              data: {
                status?: OrderStatus;
                paidAt?: Date | null;
                providerTradeNo?: string;
                paymentProvider?: string;
              };
            }) => {
              if (args.data.paymentProvider !== undefined) {
                if (
                  options.mutateAuthoritativeStateOnProviderNormalizationCasMiss &&
                  !providerNormalizationCasMissInjected
                ) {
                  providerNormalizationCasMissInjected = true;
                  options.mutateAuthoritativeStateOnProviderNormalizationCasMiss(
                    staged
                  );
                  return { count: 0 };
                }
                if (
                  staged.order.id !== args.where.id ||
                  staged.order.paymentProvider !== null ||
                  staged.order.paymentType !== args.where.paymentType ||
                  staged.order.paymentTradeNo !==
                    args.where.paymentTradeNo ||
                  staged.order.amount !== args.where.amount
                ) {
                  return { count: 0 };
                }
                staged.order = {
                  ...staged.order,
                  paymentProvider: args.data.paymentProvider,
                  updatedAt: new Date("2030-08-26T12:00:00.000Z")
                };
                return { count: 1 };
              }

              if (
                staged.order.id !== args.where.id ||
                staged.order.status !== args.where.status
              ) {
                return { count: 0 };
              }
              staged.order = {
                ...staged.order,
                status: args.data.status ?? staged.order.status,
                paidAt:
                  args.data.paidAt === undefined
                    ? staged.order.paidAt
                    : args.data.paidAt,
                ...(args.data.providerTradeNo === undefined
                  ? {}
                  : { providerTradeNo: args.data.providerTradeNo }),
                updatedAt: args.data.paidAt ?? new Date()
              };
              return { count: 1 };
            }
          )
        },
        userQuota: {
          create: vi.fn(
            async (args: { data: { remainingCredits: number } }) => {
              staged.remainingCredits = args.data.remainingCredits;
              return {
                id: "quota-1",
                userId: staged.order.userId,
                remainingCredits: staged.remainingCredits,
                createdAt: new Date(),
                updatedAt: new Date()
              };
            }
          ),
          update: vi.fn(
            async (args: { data: { remainingCredits: number } }) => {
              staged.remainingCredits = args.data.remainingCredits;
              return {
                id: "quota-1",
                userId: staged.order.userId,
                remainingCredits: staged.remainingCredits,
                createdAt: new Date(),
                updatedAt: new Date()
              };
            }
          )
        },
        accountCreditEvent: {
          findUnique: vi.fn(
            async (args: { where: { idempotencyKey: string } }) =>
              staged.creditEvents.find(
                (event) =>
                  event.idempotencyKey === args.where.idempotencyKey
              ) ?? null
          ),
          create: vi.fn(async (args: { data: object }) => {
            const event = {
              id: `event-${staged.creditEvents.length + 1}`,
              ...args.data,
              createdAt: new Date("2030-08-26T12:00:00.000Z")
            } as AccountCreditEvent;
            staged.creditEvents.push(event);
            return event;
          })
        },
        $queryRaw: vi.fn(async () => {
          rawQueryCount += 1;
          return rawQueryCount === 1
            ? [{ id: staged.order.userId }]
            : [
                {
                  userId: staged.order.userId,
                  remainingCredits: staged.remainingCredits
                }
              ];
        })
      } as unknown as Prisma.TransactionClient;

      try {
        const result = await operation(tx);
        committed = staged;
        return result;
      } finally {
        release();
      }
    }
  );

  const rootFindOrder = vi.fn(async () => committed.order);
  const rootUpdateOrderMany = vi.fn(
    async (args: {
      where: { id: string; status: OrderStatus };
      data: { status: OrderStatus; paidAt: Date | null };
    }) => {
      if (
        committed.order.id !== args.where.id ||
        committed.order.status !== args.where.status
      ) {
        return { count: 0 };
      }
      committed.order = {
        ...committed.order,
        status: args.data.status,
        paidAt: args.data.paidAt,
        updatedAt: new Date()
      };
      return { count: 1 };
    }
  );
  const client = {
    order: {
      findUnique: rootFindOrder,
      updateMany: rootUpdateOrderMany
    },
    $transaction: transaction
  } as unknown as PrismaClient;
  const store = createPrismaUserStore(client, {
    testHooks: {
      async afterFinancialCreditEventCreated() {
        financialEventStaged();
      }
    }
  });

  return {
    attemptCreateAttempts,
    financialEventStaged,
    receiptWriteAttempts,
    snapshot: () => cloneState(committed),
    store,
    transaction
  };
}

function paidAttempt(
  status: "PAID" | "PAID_REQUIRES_REVIEW" = "PAID",
  input: SettlePaymentAttemptFromCallbackInput = callbackA
): PaymentAttempt {
  return paymentAttempt({
    provider: input.provider,
    providerMerchantRef: input.providerMerchantRef,
    paymentType: input.paymentType,
    merchantTradeNo: input.merchantTradeNo,
    providerTradeNo: input.providerTradeNo,
    providerTradeIdentityHash: Uint8Array.from(
      createProviderTradeIdentityHash(input)
    ),
    status,
    paidAt: input.paidAt
  });
}

describe("Prisma PaymentAttempt callback settlement transaction", () => {
  it("settles ACTIVE + PENDING atomically with exactly one entitlement event", async () => {
    const fixture = createSettlementFixture();

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackA)
    ).resolves.toMatchObject({ status: "PAID", orderId: "order-1" });

    const state = fixture.snapshot();
    expect(state.order).toMatchObject({
      status: "PAID",
      providerTradeNo: callbackA.providerTradeNo,
      paidAt
    });
    expect(state.attempts[0]).toMatchObject({
      status: "PAID",
      providerTradeNo: callbackA.providerTradeNo,
      paidAt
    });
    expect(state.remainingCredits).toBe(120);
    expect(state.creditEvents).toHaveLength(1);
    expect(state.creditEvents[0]).toMatchObject({
      sourceType: "PAYMENT_PAID",
      idempotencyKey: "payment-paid:order-1"
    });
    expect(fixture.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "ReadCommitted"
    });
  });

  it("lets RETIRED + PENDING win without changing another Attempt", async () => {
    const other = paymentAttempt({
      id: "attempt-other",
      ordinal: 2,
      merchantTradeNo: "order_other"
    });
    const fixture = createSettlementFixture({
      attempts: [paymentAttempt({ status: "RETIRED" }), other]
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackA)
    ).resolves.toMatchObject({ status: "PAID" });
    expect(fixture.snapshot().attempts).toEqual([
      expect.objectContaining({ id: "attempt-1", status: "PAID" }),
      expect.objectContaining({ id: "attempt-other", status: "ACTIVE" })
    ]);
  });

  it("treats PAID + same receipt as an exact zero-write replay", async () => {
    const fixture = createSettlementFixture({
      attempts: [paidAttempt()],
      initialOrder: settlementOrder({
        status: "PAID",
        providerTradeNo: callbackA.providerTradeNo,
        paidAt
      }),
      remainingCredits: 120
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackA)
    ).resolves.toMatchObject({ status: "EXACT_PAID_REPLAY" });
    expect(fixture.receiptWriteAttempts).not.toHaveBeenCalled();
    expect(fixture.snapshot()).toMatchObject({
      remainingCredits: 120,
      creditEvents: []
    });
  });

  it("rejects an exact PAID receipt when persisted Attempt and Order paidAt differ", async () => {
    const fixture = createSettlementFixture({
      attempts: [
        paidAttempt("PAID", {
          ...callbackA,
          paidAt: new Date("2030-08-26T11:59:00.000Z")
        })
      ],
      initialOrder: settlementOrder({
        status: "PAID",
        providerTradeNo: callbackA.providerTradeNo,
        paidAt
      }),
      remainingCredits: 120
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackA)
    ).resolves.toEqual({ status: "INVALID_PAYMENT_STATE" });
    expect(fixture.receiptWriteAttempts).not.toHaveBeenCalled();
    expect(fixture.snapshot()).toMatchObject({
      remainingCredits: 120,
      creditEvents: []
    });
  });

  it("rejects a different receipt for the same PAID Attempt", async () => {
    const fixture = createSettlementFixture({
      attempts: [paidAttempt()],
      initialOrder: settlementOrder({
        status: "PAID",
        providerTradeNo: callbackA.providerTradeNo,
        paidAt
      })
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback({
        ...callbackA,
        providerTradeNo: "Y-DIFFERENT"
      })
    ).resolves.toEqual({ status: "PAYMENT_REFERENCE_CONFLICT" });
    expect(fixture.receiptWriteAttempts).not.toHaveBeenCalled();
  });

  it("rejects PAID replay when the Order merchant mirror belongs to another Attempt", async () => {
    const initialAttempt = paymentAttempt();
    const secondAttempt = {
      ...paidAttempt("PAID", callbackB),
      id: "attempt-2",
      ordinal: 2
    };
    const fixture = createSettlementFixture({
      attempts: [initialAttempt, secondAttempt],
      initialOrder: settlementOrder({
        status: "PAID",
        paymentTradeNo: initialAttempt.merchantTradeNo,
        providerTradeNo: callbackB.providerTradeNo,
        paidAt
      }),
      remainingCredits: 120
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackB)
    ).resolves.toEqual({ status: "INVALID_PAYMENT_STATE" });
    expect(fixture.receiptWriteAttempts).not.toHaveBeenCalled();
    expect(fixture.snapshot()).toMatchObject({
      remainingCredits: 120,
      creditEvents: []
    });
  });

  it("records ACTIVE + CANCELLED as REVIEW without entitlement writes", async () => {
    const fixture = createSettlementFixture({
      initialOrder: settlementOrder({ status: "CANCELLED" })
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackA)
    ).resolves.toMatchObject({ status: "PAID_REQUIRES_REVIEW" });

    const state = fixture.snapshot();
    expect(state.order).toMatchObject({
      status: "CANCELLED",
      providerTradeNo: null,
      paidAt: null
    });
    expect(state.attempts[0]).toMatchObject({
      status: "PAID_REQUIRES_REVIEW",
      providerTradeNo: callbackA.providerTradeNo,
      paidAt
    });
    expect(state.remainingCredits).toBe(20);
    expect(state.creditEvents).toHaveLength(0);
  });

  it("treats REVIEW + same receipt as an exact replay", async () => {
    const fixture = createSettlementFixture({
      attempts: [paidAttempt("PAID_REQUIRES_REVIEW")],
      initialOrder: settlementOrder({ status: "CANCELLED" })
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackA)
    ).resolves.toMatchObject({ status: "EXACT_REVIEW_REPLAY" });
    expect(fixture.receiptWriteAttempts).not.toHaveBeenCalled();
  });

  it("rejects REVIEW replay when a different receipt conflicts with the mirrored winner", async () => {
    const reviewReceipt = {
      ...callbackA,
      providerTradeNo: "Y-A-REVIEW"
    };
    const fixture = createSettlementFixture({
      attempts: [paidAttempt("PAID_REQUIRES_REVIEW", reviewReceipt)],
      initialOrder: settlementOrder({
        status: "PAID",
        providerTradeNo: callbackA.providerTradeNo,
        paidAt
      }),
      remainingCredits: 120
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(reviewReceipt)
    ).resolves.toEqual({ status: "INVALID_PAYMENT_STATE" });
    expect(fixture.receiptWriteAttempts).not.toHaveBeenCalled();
    expect(fixture.snapshot()).toMatchObject({
      remainingCredits: 120,
      creditEvents: []
    });
  });

  it("revalidates authoritative Order amount after a receipt CAS-loser reread", async () => {
    const fixture = createSettlementFixture({
      initialOrder: settlementOrder({ status: "CANCELLED" }),
      mutateAuthoritativeStateOnReceiptCasMiss(state) {
        state.order = {
          ...state.order,
          amount: callbackA.amountCents + 1
        };
        state.attempts[0] = paidAttempt("PAID_REQUIRES_REVIEW");
      }
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackA)
    ).resolves.toEqual({ status: "PAYMENT_AMOUNT_MISMATCH" });
    expect(fixture.receiptWriteAttempts).toHaveBeenCalledTimes(1);
    expect(fixture.snapshot()).toMatchObject({
      remainingCredits: 20,
      creditEvents: []
    });
  });

  it("rejects a different receipt for the same REVIEW Attempt", async () => {
    const fixture = createSettlementFixture({
      attempts: [paidAttempt("PAID_REQUIRES_REVIEW")],
      initialOrder: settlementOrder({ status: "CANCELLED" })
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback({
        ...callbackA,
        providerTradeNo: "Y-DIFFERENT"
      })
    ).resolves.toEqual({ status: "PAYMENT_REFERENCE_CONFLICT" });
  });

  it("does not let a non-mirrored ordinal-2 Attempt win a PENDING Order", async () => {
    const initialAttempt = paymentAttempt();
    const secondAttempt = paymentAttempt({
      id: "attempt-2",
      ordinal: 2,
      merchantTradeNo: callbackB.merchantTradeNo
    });
    const fixture = createSettlementFixture({
      attempts: [initialAttempt, secondAttempt]
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackB)
    ).resolves.toEqual({ status: "PAYMENT_IDENTITY_MISMATCH" });
    const state = fixture.snapshot();
    expect(state.order).toMatchObject({
      status: "PENDING",
      paymentTradeNo: initialAttempt.merchantTradeNo,
      providerTradeNo: null,
      paidAt: null
    });
    expect(state.attempts[1]).toMatchObject({
      status: "ACTIVE",
      providerTradeNo: null,
      providerTradeIdentityHash: null,
      paidAt: null
    });
    expect(state.remainingCredits).toBe(20);
    expect(state.creditEvents).toHaveLength(0);
    expect(fixture.receiptWriteAttempts).not.toHaveBeenCalled();
  });

  it("records a non-winning ordinal-2 real payment as REVIEW", async () => {
    const winner = paidAttempt();
    const nonWinner = paymentAttempt({
      id: "attempt-2",
      ordinal: 2,
      merchantTradeNo: callbackB.merchantTradeNo
    });
    const fixture = createSettlementFixture({
      attempts: [winner, nonWinner],
      initialOrder: settlementOrder({
        status: "PAID",
        providerTradeNo: callbackA.providerTradeNo,
        paidAt
      }),
      remainingCredits: 120
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackB)
    ).resolves.toMatchObject({ status: "PAID_REQUIRES_REVIEW" });
    const state = fixture.snapshot();
    expect(state.order.providerTradeNo).toBe(callbackA.providerTradeNo);
    expect(state.attempts[1]).toMatchObject({
      status: "PAID_REQUIRES_REVIEW",
      providerTradeNo: callbackB.providerTradeNo
    });
    expect(state.remainingCredits).toBe(120);
    expect(state.creditEvents).toHaveLength(0);
  });

  it("does not reconcile ordinal-2 evidence when the Order merchant mirror belongs to ordinal 1", async () => {
    const initialAttempt = paymentAttempt();
    const secondAttempt = paymentAttempt({
      id: "attempt-2",
      ordinal: 2,
      merchantTradeNo: callbackB.merchantTradeNo
    });
    const fixture = createSettlementFixture({
      attempts: [initialAttempt, secondAttempt],
      initialOrder: settlementOrder({
        status: "PAID",
        paymentTradeNo: initialAttempt.merchantTradeNo,
        providerTradeNo: callbackB.providerTradeNo,
        paidAt
      }),
      remainingCredits: 120
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackB)
    ).resolves.toEqual({ status: "PAYMENT_REFERENCE_CONFLICT" });
    const state = fixture.snapshot();
    expect(state.attempts[1]).toMatchObject({
      status: "ACTIVE",
      providerTradeNo: null,
      providerTradeIdentityHash: null,
      paidAt: null
    });
    expect(state.remainingCredits).toBe(120);
    expect(state.creditEvents).toHaveLength(0);
  });

  it("rejects a second receipt for an unpaid mirrored Attempt on a PAID Order", async () => {
    const conflictingCallback = {
      ...callbackA,
      providerTradeNo: "Y-A-CONFLICT"
    };
    const fixture = createSettlementFixture({
      initialOrder: settlementOrder({
        status: "PAID",
        providerTradeNo: callbackA.providerTradeNo,
        paidAt
      }),
      remainingCredits: 120
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(conflictingCallback)
    ).resolves.toEqual({ status: "PAYMENT_REFERENCE_CONFLICT" });
    const state = fixture.snapshot();
    expect(state.attempts[0]).toMatchObject({
      status: "ACTIVE",
      providerTradeNo: null,
      providerTradeIdentityHash: null,
      paidAt: null
    });
    expect(state.order).toMatchObject({
      status: "PAID",
      paymentTradeNo: callbackA.merchantTradeNo,
      providerTradeNo: callbackA.providerTradeNo,
      paidAt
    });
    expect(state.remainingCredits).toBe(120);
    expect(state.creditEvents).toHaveLength(0);
    expect(fixture.receiptWriteAttempts).not.toHaveBeenCalled();
  });

  it("records a real Attempt payment after Admin PAID as REVIEW", async () => {
    const fixture = createSettlementFixture({
      initialOrder: settlementOrder({
        status: "PAID",
        providerTradeNo: null,
        paidAt
      }),
      remainingCredits: 120
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackA)
    ).resolves.toMatchObject({ status: "PAID_REQUIRES_REVIEW" });
    expect(fixture.snapshot()).toMatchObject({
      order: { status: "PAID", providerTradeNo: null, paidAt },
      remainingCredits: 120,
      creditEvents: []
    });
  });

  it("reconciles only the exact old-runtime paid mirror without another entitlement", async () => {
    const oldPaidAt = new Date("2030-08-26T11:55:00.000Z");
    const fixture = createSettlementFixture({
      initialOrder: settlementOrder({
        status: "PAID",
        providerTradeNo: callbackA.providerTradeNo,
        paidAt: oldPaidAt
      }),
      remainingCredits: 120
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackA)
    ).resolves.toMatchObject({ status: "PAID_EVIDENCE_RECONCILED" });
    const state = fixture.snapshot();
    expect(state.attempts[0]).toMatchObject({
      status: "PAID",
      providerTradeNo: callbackA.providerTradeNo,
      paidAt: oldPaidAt
    });
    expect(state.remainingCredits).toBe(120);
    expect(state.creditEvents).toHaveLength(0);
  });

  it.each([
    { providerTradeNo: "unexpected", paidAt: null },
    { providerTradeNo: null, paidAt }
  ])("fails closed for a partial PENDING Order receipt: %j", async (partial) => {
    const fixture = createSettlementFixture({
      initialOrder: settlementOrder(partial)
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackA)
    ).resolves.toEqual({ status: "INVALID_PAYMENT_STATE" });
    expect(fixture.receiptWriteAttempts).not.toHaveBeenCalled();
    expect(fixture.snapshot().creditEvents).toHaveLength(0);
  });

  it.each([
    paymentAttempt({
      providerTradeNo: callbackA.providerTradeNo,
      providerTradeIdentityHash: Uint8Array.from(
        createProviderTradeIdentityHash(callbackA)
      ),
      paidAt,
      status: "ACTIVE"
    }),
    paymentAttempt({ status: "PAID" })
  ])("fails closed for incoherent Attempt receipt/status state", async (attempt) => {
    const fixture = createSettlementFixture({ attempts: [attempt] });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackA)
    ).resolves.toEqual({ status: "INVALID_PAYMENT_STATE" });
    expect(fixture.receiptWriteAttempts).not.toHaveBeenCalled();
    expect(fixture.snapshot().creditEvents).toHaveLength(0);
  });

  it("fails closed when a CANCELLED Order already contains paid evidence", async () => {
    const fixture = createSettlementFixture({
      initialOrder: settlementOrder({
        status: "CANCELLED",
        providerTradeNo: "unexpected",
        paidAt
      })
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackA)
    ).resolves.toEqual({ status: "INVALID_PAYMENT_STATE" });
    expect(fixture.receiptWriteAttempts).not.toHaveBeenCalled();
  });

  it.each([
    ["provider", { provider: "other" }, "PAYMENT_IDENTITY_MISMATCH"],
    [
      "merchant ref",
      { providerMerchantRef: "merchant-2" },
      "PAYMENT_IDENTITY_MISMATCH"
    ],
    ["type", { paymentType: "wxpay" }, "PAYMENT_IDENTITY_MISMATCH"],
    ["merchant trade", { merchantTradeNo: "missing" }, "PAYMENT_ATTEMPT_NOT_FOUND"],
    ["amount", { amountCents: 991 }, "PAYMENT_AMOUNT_MISMATCH"]
  ] as const)(
    "fails closed before financial mutation for %s mismatch",
    async (_name, override, status) => {
      const fixture = createSettlementFixture();

      await expect(
        fixture.store.settlePaymentAttemptFromCallback({
          ...callbackA,
          ...override
        })
      ).resolves.toEqual({ status });
      expect(fixture.receiptWriteAttempts).not.toHaveBeenCalled();
      expect(fixture.snapshot()).toMatchObject({
        order: { status: "PENDING" },
        remainingCredits: 20,
        creditEvents: []
      });
    }
  );

  it.each([
    ["provider", { paymentProvider: "other-provider" }],
    ["type", { paymentType: "wxpay" }],
    ["merchant mirror", { paymentTradeNo: "order_other" }],
    ["order association", { id: "order-other" }]
  ] as const)(
    "fails closed for Order %s identity drift",
    async (_name, orderOverride) => {
      const fixture = createSettlementFixture({
        initialOrder: settlementOrder(orderOverride)
      });

      await expect(
        fixture.store.settlePaymentAttemptFromCallback(callbackA)
      ).resolves.toEqual({ status: "PAYMENT_IDENTITY_MISMATCH" });
      expect(fixture.receiptWriteAttempts).not.toHaveBeenCalled();
      expect(fixture.snapshot().creditEvents).toHaveLength(0);
    }
  );

  it("persists the canonical 32-byte Provider receipt identity hash", async () => {
    const fixture = createSettlementFixture();

    await fixture.store.settlePaymentAttemptFromCallback(callbackA);

    const hash = fixture.snapshot().attempts[0]?.providerTradeIdentityHash;
    expect(hash).not.toBeNull();
    expect(hash).toHaveLength(32);
    expect(Buffer.from(hash ?? [])).toEqual(
      createProviderTradeIdentityHash(callbackA)
    );
  });

  it("rolls back staged Order, quota, event, and Attempt when receipt write hits P2002", async () => {
    const fixture = createSettlementFixture({
      failReceiptWriteWithP2002: true
    });

    await expect(
      fixture.store.settlePaymentAttemptFromCallback(callbackA)
    ).resolves.toEqual({ status: "PAYMENT_REFERENCE_CONFLICT" });
    expect(fixture.financialEventStaged).toHaveBeenCalledTimes(1);
    expect(fixture.receiptWriteAttempts).toHaveBeenCalledTimes(1);
    expect(fixture.snapshot()).toMatchObject({
      order: { status: "PENDING", providerTradeNo: null, paidAt: null },
      attempts: [
        {
          status: "ACTIVE",
          providerTradeNo: null,
          providerTradeIdentityHash: null,
          paidAt: null
        }
      ],
      remainingCredits: 20,
      creditEvents: []
    });
  });

  it("converges concurrent identical callbacks to one winner and one exact replay", async () => {
    const fixture = createSettlementFixture();

    const results = await Promise.all([
      fixture.store.settlePaymentAttemptFromCallback(callbackA),
      fixture.store.settlePaymentAttemptFromCallback(callbackA)
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "EXACT_PAID_REPLAY",
      "PAID"
    ]);
    const state = fixture.snapshot();
    expect(state.order.status).toBe("PAID");
    expect(state.attempts[0]?.status).toBe("PAID");
    expect(state.remainingCredits).toBe(120);
    expect(state.creditEvents).toHaveLength(1);
  });

  it("records B as REVIEW only after mirrored A wins settlement", async () => {
    const secondAttempt = paymentAttempt({
      id: "attempt-2",
      ordinal: 2,
      merchantTradeNo: callbackB.merchantTradeNo
    });
    const fixture = createSettlementFixture({
      attempts: [paymentAttempt(), secondAttempt]
    });

    const winner = await fixture.store.settlePaymentAttemptFromCallback(
      callbackA
    );
    expect(winner).toMatchObject({ status: "PAID" });
    expect(fixture.snapshot()).toMatchObject({
      order: { status: "PAID", providerTradeNo: callbackA.providerTradeNo },
      attempts: [
        { status: "PAID" },
        { status: "ACTIVE", providerTradeNo: null, paidAt: null }
      ],
      remainingCredits: 120,
      creditEvents: [{ idempotencyKey: "payment-paid:order-1" }]
    });

    const nonWinner = await fixture.store.settlePaymentAttemptFromCallback(
      callbackB
    );
    expect(nonWinner).toMatchObject({ status: "PAID_REQUIRES_REVIEW" });
    const state = fixture.snapshot();
    expect(state.attempts.map((attempt) => attempt.status).sort()).toEqual([
      "PAID",
      "PAID_REQUIRES_REVIEW"
    ]);
    expect(state.remainingCredits).toBe(120);
    expect(state.creditEvents).toHaveLength(1);
  });

  it("keeps cancel-wins compatible: CANCELLED + REVIEW and no credits", async () => {
    const fixture = createSettlementFixture({
      initialOrder: settlementOrder({ status: "CANCELLED" })
    });

    await fixture.store.settlePaymentAttemptFromCallback(callbackA);

    expect(fixture.snapshot()).toMatchObject({
      order: { status: "CANCELLED" },
      attempts: [{ status: "PAID_REQUIRES_REVIEW" }],
      remainingCredits: 20,
      creditEvents: []
    });
  });

  it("keeps payment-wins compatible: later Admin cancel cannot overwrite PAID", async () => {
    const fixture = createSettlementFixture();

    await fixture.store.settlePaymentAttemptFromCallback(callbackA);
    await expect(
      fixture.store.updateOrderStatus("order-1", "CANCELLED")
    ).rejects.toThrow("ORDER_PAID_CANNOT_BE_CANCELLED");

    expect(fixture.snapshot()).toMatchObject({
      order: { status: "PAID" },
      attempts: [{ status: "PAID" }],
      remainingCredits: 120,
      creditEvents: [{ idempotencyKey: "payment-paid:order-1" }]
    });
  });
});

describe("Prisma historical legacy callback materialization transaction", () => {
  it("materializes legacy PENDING and settles one entitlement atomically", async () => {
    const fixture = createSettlementFixture({
      attempts: [],
      initialOrder: settlementOrder({ paymentProvider: null })
    });

    await expect(
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      )
    ).resolves.toMatchObject({ status: "PAID", orderId: "order-1" });

    expect(fixture.snapshot()).toMatchObject({
      order: {
        status: "PAID",
        paymentProvider: "epay",
        providerTradeNo: callbackA.providerTradeNo,
        paidAt
      },
      attempts: [
        {
          ordinal: INITIAL_PAYMENT_ATTEMPT_ORDINAL,
          status: "PAID",
          providerTradeNo: callbackA.providerTradeNo,
          paidAt
        }
      ],
      remainingCredits: 120,
      creditEvents: [{ idempotencyKey: "payment-paid:order-1" }]
    });
    expect(fixture.snapshot().attempts[0]?.providerTradeIdentityHash).toEqual(
      Uint8Array.from(createProviderTradeIdentityHash(callbackA))
    );
    expect(fixture.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "ReadCommitted"
    });
  });

  it("converges duplicate legacy PENDING callbacks without duplicate entitlement", async () => {
    const fixture = createSettlementFixture({ attempts: [] });

    const results = await Promise.all([
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      ),
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      )
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "EXACT_PAID_REPLAY",
      "PAID"
    ]);
    expect(fixture.snapshot()).toMatchObject({
      order: { status: "PAID" },
      attempts: [{ status: "PAID" }],
      remainingCredits: 120,
      creditEvents: [{ idempotencyKey: "payment-paid:order-1" }]
    });
    expect(fixture.attemptCreateAttempts).toHaveBeenCalledTimes(1);
  });

  it("materializes legacy CANCELLED as durable REVIEW without entitlement", async () => {
    const fixture = createSettlementFixture({
      attempts: [],
      initialOrder: settlementOrder({
        status: "CANCELLED",
        paymentProvider: null
      })
    });

    await expect(
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      )
    ).resolves.toMatchObject({ status: "PAID_REQUIRES_REVIEW" });

    expect(fixture.snapshot()).toMatchObject({
      order: {
        status: "CANCELLED",
        paymentProvider: "epay",
        providerTradeNo: null,
        paidAt: null
      },
      attempts: [
        {
          status: "PAID_REQUIRES_REVIEW",
          providerTradeNo: callbackA.providerTradeNo,
          paidAt
        }
      ],
      remainingCredits: 20,
      creditEvents: []
    });
  });

  it("converges a duplicate legacy CANCELLED callback to exact REVIEW replay", async () => {
    const fixture = createSettlementFixture({
      attempts: [],
      initialOrder: settlementOrder({ status: "CANCELLED" })
    });

    await expect(
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      )
    ).resolves.toMatchObject({ status: "PAID_REQUIRES_REVIEW" });
    await expect(
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      )
    ).resolves.toMatchObject({ status: "EXACT_REVIEW_REPLAY" });
    expect(fixture.snapshot()).toMatchObject({
      order: { status: "CANCELLED" },
      attempts: [{ status: "PAID_REQUIRES_REVIEW" }],
      remainingCredits: 20,
      creditEvents: []
    });
  });

  it("materializes exact legacy PAID evidence using persisted Order.paidAt", async () => {
    const authoritativePaidAt = new Date("2030-08-26T11:45:00.000Z");
    const fixture = createSettlementFixture({
      attempts: [],
      initialOrder: settlementOrder({
        status: "PAID",
        paymentProvider: null,
        providerTradeNo: callbackA.providerTradeNo,
        paidAt: authoritativePaidAt
      }),
      remainingCredits: 120
    });

    await expect(
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback({
        ...legacyCallbackA,
        paidAt: new Date("2030-08-26T12:30:00.000Z")
      })
    ).resolves.toMatchObject({ status: "PAID_EVIDENCE_RECONCILED" });

    expect(fixture.snapshot()).toMatchObject({
      order: {
        status: "PAID",
        paymentProvider: "epay",
        providerTradeNo: callbackA.providerTradeNo,
        paidAt: authoritativePaidAt
      },
      attempts: [
        {
          status: "PAID",
          providerTradeNo: callbackA.providerTradeNo,
          paidAt: authoritativePaidAt
        }
      ],
      remainingCredits: 120,
      creditEvents: []
    });
  });

  it("rejects conflicting legacy PAID evidence without normalization or Attempt", async () => {
    const fixture = createSettlementFixture({
      attempts: [],
      initialOrder: settlementOrder({
        status: "PAID",
        paymentProvider: null,
        providerTradeNo: "Y-OTHER",
        paidAt
      }),
      remainingCredits: 120
    });

    await expect(
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      )
    ).resolves.toEqual({ status: "PAYMENT_REFERENCE_CONFLICT" });
    expect(fixture.snapshot()).toMatchObject({
      order: { paymentProvider: null, providerTradeNo: "Y-OTHER" },
      attempts: [],
      remainingCredits: 120,
      creditEvents: []
    });
  });

  it.each([
    { providerTradeNo: null, paidAt },
    { providerTradeNo: callbackA.providerTradeNo, paidAt: null },
    {
      providerTradeNo: callbackA.providerTradeNo,
      paidAt: new Date(Number.NaN)
    }
  ])("rejects partial/corrupt legacy PAID evidence: %j", async (evidence) => {
    const fixture = createSettlementFixture({
      attempts: [],
      initialOrder: settlementOrder({
        status: "PAID",
        paymentProvider: null,
        ...evidence
      }),
      remainingCredits: 120
    });

    await expect(
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      )
    ).resolves.toEqual({ status: "INVALID_PAYMENT_STATE" });
    expect(fixture.snapshot().attempts).toHaveLength(0);
    expect(fixture.snapshot().order.paymentProvider).toBeNull();
  });

  it("rejects a non-EPay historical provider identity", async () => {
    const fixture = createSettlementFixture({
      attempts: [],
      initialOrder: settlementOrder({ paymentProvider: "other-provider" })
    });

    await expect(
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      )
    ).resolves.toEqual({ status: "PAYMENT_IDENTITY_MISMATCH" });
    expect(fixture.attemptCreateAttempts).not.toHaveBeenCalled();
  });

  it("continues after a provider-normalization CAS loser rereads exact epay identity", async () => {
    const fixture = createSettlementFixture({
      attempts: [],
      initialOrder: settlementOrder({ paymentProvider: null }),
      mutateAuthoritativeStateOnProviderNormalizationCasMiss(state) {
        state.order = { ...state.order, paymentProvider: "epay" };
      }
    });

    await expect(
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      )
    ).resolves.toMatchObject({ status: "PAID" });
    expect(fixture.snapshot().order.paymentProvider).toBe("epay");
  });

  it("fails closed after a provider-normalization CAS loser sees identity drift", async () => {
    const fixture = createSettlementFixture({
      attempts: [],
      initialOrder: settlementOrder({ paymentProvider: null }),
      mutateAuthoritativeStateOnProviderNormalizationCasMiss(state) {
        state.order = { ...state.order, paymentProvider: "other-provider" };
      }
    });

    await expect(
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      )
    ).resolves.toEqual({ status: "PAYMENT_IDENTITY_MISMATCH" });
    expect(fixture.snapshot()).toMatchObject({
      order: { status: "PENDING", paymentProvider: null },
      attempts: [],
      remainingCredits: 20,
      creditEvents: []
    });
  });

  it("strictly converges an ordinal create P2002 to an identical REVIEW winner", async () => {
    const fixture = createSettlementFixture({
      attempts: [],
      initialOrder: settlementOrder({
        status: "CANCELLED",
        paymentProvider: null
      }),
      attemptCreateP2002: {
        target: "PaymentAttempt_orderId_ordinal_key",
        mutateCommittedState(state) {
          state.order = { ...state.order, paymentProvider: "epay" };
          state.attempts = [paidAttempt("PAID_REQUIRES_REVIEW")];
        }
      }
    });

    await expect(
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      )
    ).resolves.toMatchObject({ status: "EXACT_REVIEW_REPLAY" });
    expect(fixture.attemptCreateAttempts).toHaveBeenCalledTimes(1);
    expect(fixture.transaction).toHaveBeenCalledTimes(2);
    expect(fixture.snapshot()).toMatchObject({
      order: { status: "CANCELLED", paymentProvider: "epay" },
      attempts: [{ status: "PAID_REQUIRES_REVIEW" }],
      remainingCredits: 20,
      creditEvents: []
    });
  });

  it("rejects create-P2002 convergence when the winner identity differs", async () => {
    const fixture = createSettlementFixture({
      attempts: [],
      initialOrder: settlementOrder({ status: "CANCELLED" }),
      attemptCreateP2002: {
        target: "PaymentAttempt_merchantTradeNo_key",
        mutateCommittedState(state) {
          state.attempts = [
            paidAttempt("PAID_REQUIRES_REVIEW", {
              ...callbackA,
              providerMerchantRef: "other-merchant"
            })
          ];
        }
      }
    });

    await expect(
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      )
    ).resolves.toEqual({ status: "PAYMENT_REFERENCE_CONFLICT" });
    expect(fixture.snapshot()).toMatchObject({
      order: { status: "CANCELLED" },
      remainingCredits: 20,
      creditEvents: []
    });
  });

  it("does not adopt receipt-hash P2002 and rolls back all staged writes", async () => {
    const fixture = createSettlementFixture({
      attempts: [],
      failReceiptWriteWithP2002: true,
      initialOrder: settlementOrder({ paymentProvider: null })
    });

    await expect(
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      )
    ).resolves.toEqual({ status: "PAYMENT_REFERENCE_CONFLICT" });
    expect(fixture.financialEventStaged).toHaveBeenCalledTimes(1);
    expect(fixture.snapshot()).toMatchObject({
      order: {
        status: "PENDING",
        paymentProvider: null,
        providerTradeNo: null,
        paidAt: null
      },
      attempts: [],
      remainingCredits: 20,
      creditEvents: []
    });
  });

  it("keeps legacy cancel-wins compatible with durable REVIEW", async () => {
    const fixture = createSettlementFixture({
      attempts: [],
      initialOrder: settlementOrder({ paymentProvider: null }),
      mutateAuthoritativeStateOnProviderNormalizationCasMiss(state) {
        state.order = {
          ...state.order,
          status: "CANCELLED",
          paymentProvider: "epay"
        };
      }
    });

    await expect(
      fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
        legacyCallbackA
      )
    ).resolves.toMatchObject({ status: "PAID_REQUIRES_REVIEW" });
    expect(fixture.snapshot()).toMatchObject({
      order: { status: "CANCELLED", providerTradeNo: null, paidAt: null },
      attempts: [{ status: "PAID_REQUIRES_REVIEW" }],
      remainingCredits: 20,
      creditEvents: []
    });
  });

  it("keeps legacy payment-wins compatible with later Admin cancel CAS", async () => {
    const fixture = createSettlementFixture({ attempts: [] });

    await fixture.store.materializeAndSettleLegacyPaymentAttemptFromCallback(
      legacyCallbackA
    );
    await expect(
      fixture.store.updateOrderStatus("order-1", "CANCELLED")
    ).rejects.toThrow("ORDER_PAID_CANNOT_BE_CANCELLED");
    expect(fixture.snapshot()).toMatchObject({
      order: { status: "PAID" },
      attempts: [{ status: "PAID" }],
      remainingCredits: 120,
      creditEvents: [{ idempotencyKey: "payment-paid:order-1" }]
    });
  });
});
