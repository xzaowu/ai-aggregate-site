import type { PaymentAttempt, Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  INITIAL_PAYMENT_ATTEMPT_ORDINAL,
  createProviderTradeIdentityHash,
  validatePaymentAttemptStoredIdentity,
  type PaymentAttemptStoredIdentityInput,
  type ProviderTradeIdentityInput
} from "../src/payments/payment-attempt";
import { createPrismaUserStore } from "../src/store";

const initialPaymentInput = {
  orderId: "order-1",
  provider: "epay",
  providerMerchantRef: "merchant-1",
  paymentType: "alipay",
  merchantTradeNo: "order_order-1",
  paymentUrl: "https://pay.example.com/submit.php?winner=1"
};

const providerTradeIdentity: ProviderTradeIdentityInput = {
  provider: "epay",
  providerMerchantRef: "merchant-1",
  providerTradeNo: "Y123"
};

const storedIdentity: PaymentAttemptStoredIdentityInput = {
  id: "attempt-1",
  orderId: "order-1",
  ordinal: INITIAL_PAYMENT_ATTEMPT_ORDINAL,
  provider: "epay",
  providerMerchantRef: "merchant-1",
  paymentType: "alipay",
  merchantTradeNo: "order_order-1",
  providerTradeNo: null
};

function paymentAttempt(
  overrides: Partial<PaymentAttempt> = {}
): PaymentAttempt {
  const attempt: PaymentAttempt = {
    id: "attempt-1",
    orderId: "order-1",
    ordinal: INITIAL_PAYMENT_ATTEMPT_ORDINAL,
    provider: "epay",
    providerMerchantRef: "merchant-1",
    paymentType: "alipay",
    merchantTradeNo: "order_order-1",
    providerTradeNo: "Y123",
    providerTradeIdentityHash: null,
    status: "ACTIVE",
    paidAt: null,
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    updatedAt: new Date("2030-01-01T00:01:00.000Z"),
    ...overrides
  };

  if (!("providerTradeIdentityHash" in overrides)) {
    attempt.providerTradeIdentityHash =
      attempt.providerTradeNo === null
        ? null
        : Uint8Array.from(
            createProviderTradeIdentityHash({
              provider: attempt.provider,
              providerMerchantRef: attempt.providerMerchantRef,
              providerTradeNo: attempt.providerTradeNo
            })
          );
  }

  return attempt;
}

function createPaymentAttemptReadFixture(result: PaymentAttempt | null) {
  const findUnique = vi.fn().mockResolvedValue(result);
  const store = createPrismaUserStore({
    paymentAttempt: { findUnique }
  } as unknown as PrismaClient);

  return { findUnique, store };
}

function paymentOrder(
  overrides: Partial<
    Prisma.OrderGetPayload<{ include: { plan: true } }>
  > = {}
): Prisma.OrderGetPayload<{ include: { plan: true } }> {
  return {
    id: initialPaymentInput.orderId,
    userId: "user-1",
    planId: "plan-1",
    amount: 2900,
    credits: 300,
    status: "PENDING",
    paymentProvider: null,
    paymentType: null,
    paymentTradeNo: null,
    providerTradeNo: null,
    paymentUrl: null,
    paidAt: null,
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    updatedAt: new Date("2030-01-01T00:00:00.000Z"),
    plan: {
      id: "plan-1",
      name: "Starter",
      slug: null,
      price: 2900,
      credits: 300,
      description: null,
      features: [],
      enabled: true,
      sortOrder: 1,
      highlighted: false,
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      updatedAt: new Date("2030-01-01T00:00:00.000Z")
    },
    ...overrides
  };
}

function initializedPaymentOrder(
  overrides: Partial<
    Prisma.OrderGetPayload<{ include: { plan: true } }>
  > = {}
) {
  return paymentOrder({
    paymentProvider: initialPaymentInput.provider,
    paymentType: initialPaymentInput.paymentType,
    paymentTradeNo: initialPaymentInput.merchantTradeNo,
    paymentUrl: initialPaymentInput.paymentUrl,
    ...overrides
  });
}

function initialPaymentAttempt(
  overrides: Partial<PaymentAttempt> = {}
): PaymentAttempt {
  return paymentAttempt({
    orderId: initialPaymentInput.orderId,
    ordinal: INITIAL_PAYMENT_ATTEMPT_ORDINAL,
    provider: initialPaymentInput.provider,
    providerMerchantRef: initialPaymentInput.providerMerchantRef,
    paymentType: initialPaymentInput.paymentType,
    merchantTradeNo: initialPaymentInput.merchantTradeNo,
    providerTradeNo: null,
    providerTradeIdentityHash: null,
    status: "ACTIVE",
    paidAt: null,
    ...overrides
  });
}

describe("PaymentAttempt identity foundation", () => {
  it("keeps the initial Attempt ordinal in one named constant", () => {
    expect(INITIAL_PAYMENT_ATTEMPT_ORDINAL).toBe(1);
  });

  it("creates a deterministic SHA-256 Buffer with the versioned encoding", () => {
    const first = createProviderTradeIdentityHash(providerTradeIdentity);
    const second = createProviderTradeIdentityHash({
      ...providerTradeIdentity
    });

    expect(Buffer.isBuffer(first)).toBe(true);
    expect(first).toHaveLength(32);
    expect(second).toEqual(first);
    expect(first.toString("hex")).toBe(
      "53887d5ba68467e0cc3d665f7b0278f6838c8a998fc0b5077bd33f4d8955cdbc"
    );
  });

  it.each([
    ["provider", { provider: "another-provider" }],
    ["providerMerchantRef", { providerMerchantRef: "merchant-2" }],
    ["providerTradeNo", { providerTradeNo: "Y124" }]
  ] as const)("changes when %s changes", (_field, override) => {
    expect(
      createProviderTradeIdentityHash({
        ...providerTradeIdentity,
        ...override
      })
    ).not.toEqual(createProviderTradeIdentityHash(providerTradeIdentity));
  });

  it("does not create delimiter-ambiguous preimages", () => {
    const first = createProviderTradeIdentityHash({
      provider: "a:b",
      providerMerchantRef: "c",
      providerTradeNo: "d"
    });
    const second = createProviderTradeIdentityHash({
      provider: "a",
      providerMerchantRef: "b:c",
      providerTradeNo: "d"
    });

    expect(first).not.toEqual(second);
  });

  it("keeps unicode identities deterministic and hashes exact stored values", () => {
    const unicode = {
      provider: "支付",
      providerMerchantRef: "商户-甲",
      providerTradeNo: "交易-😀"
    };

    expect(createProviderTradeIdentityHash(unicode)).toEqual(
      createProviderTradeIdentityHash(unicode)
    );
    expect(
      createProviderTradeIdentityHash({
        ...providerTradeIdentity,
        providerMerchantRef: " merchant-1 "
      })
    ).not.toEqual(createProviderTradeIdentityHash(providerTradeIdentity));
  });

  it.each([null, undefined])(
    "fails closed instead of hashing absent providerTradeNo: %s",
    (providerTradeNo) => {
      expect(() =>
        createProviderTradeIdentityHash({
          ...providerTradeIdentity,
          providerTradeNo: providerTradeNo as unknown as string
        })
      ).toThrow(TypeError);
    }
  );

  it("never includes an extra merchant secret in the hash preimage", () => {
    const withSecretA = {
      ...providerTradeIdentity,
      merchantKey: "secret-a"
    };
    const withSecretB = {
      ...providerTradeIdentity,
      merchantKey: "secret-b"
    };

    expect(createProviderTradeIdentityHash(withSecretA)).toEqual(
      createProviderTradeIdentityHash(withSecretB)
    );
  });

  it.each([
    ["provider", "p".repeat(21)],
    ["providerMerchantRef", "m".repeat(192)],
    ["paymentType", "t".repeat(21)],
    ["merchantTradeNo", "o".repeat(192)],
    ["providerTradeNo", "y".repeat(192)]
  ] as const)("rejects %s values beyond the schema limit", (field, value) => {
    expect(() =>
      validatePaymentAttemptStoredIdentity({
        ...storedIdentity,
        [field]: value
      })
    ).toThrow(TypeError);
  });

  it.each([
    "provider",
    "providerMerchantRef",
    "paymentType",
    "merchantTradeNo",
    "providerTradeNo"
  ] as const)("rejects empty or control-bearing %s", (field) => {
    expect(() =>
      validatePaymentAttemptStoredIdentity({
        ...storedIdentity,
        [field]: "\u0000invalid"
      })
    ).toThrow(TypeError);
    expect(() =>
      validatePaymentAttemptStoredIdentity({
        ...storedIdentity,
        [field]: "   "
      })
    ).toThrow(TypeError);
  });

  it("validates without trimming or rewriting stored identity", () => {
    const identity = {
      ...storedIdentity,
      providerMerchantRef: " merchant-1 ",
      providerTradeNo: " Y123 "
    };

    expect(validatePaymentAttemptStoredIdentity(identity)).toEqual(identity);
  });
});

describe("Prisma PaymentAttempt read store", () => {
  it("finds by globally unique merchantTradeNo and maps every field", async () => {
    const attempt = paymentAttempt();
    const { findUnique, store } = createPaymentAttemptReadFixture(attempt);

    const result = await store.findPaymentAttemptByMerchantTradeNo(
      attempt.merchantTradeNo
    );

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      where: { merchantTradeNo: attempt.merchantTradeNo }
    });
    expect(result).toEqual({
      ...attempt,
      providerTradeIdentityHash: Buffer.from(
        attempt.providerTradeIdentityHash ?? []
      )
    });
    expect(Buffer.isBuffer(result?.providerTradeIdentityHash)).toBe(true);
    expect(result?.providerTradeIdentityHash).not.toBe(
      attempt.providerTradeIdentityHash
    );
  });

  it.each([INITIAL_PAYMENT_ATTEMPT_ORDINAL, 2])(
    "finds order slot ordinal %i through the compound unique identity",
    async (ordinal) => {
      const attempt = paymentAttempt({ ordinal });
      const { findUnique, store } = createPaymentAttemptReadFixture(attempt);

      await expect(
        store.findPaymentAttemptByOrderAndOrdinal(attempt.orderId, ordinal)
      ).resolves.toMatchObject({ orderId: attempt.orderId, ordinal });
      expect(findUnique).toHaveBeenCalledWith({
        where: {
          orderId_ordinal: { orderId: attempt.orderId, ordinal }
        }
      });
    }
  );

  it("returns null when either unique lookup finds no row", async () => {
    const { store } = createPaymentAttemptReadFixture(null);

    await expect(
      store.findPaymentAttemptByMerchantTradeNo("order_missing")
    ).resolves.toBeNull();
    await expect(
      store.findPaymentAttemptByOrderAndOrdinal(
        "order-missing",
        INITIAL_PAYMENT_ATTEMPT_ORDINAL
      )
    ).resolves.toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN, 2_147_483_648])(
    "rejects invalid ordinal %s before querying Prisma",
    async (ordinal) => {
      const { findUnique, store } = createPaymentAttemptReadFixture(null);

      await expect(
        store.findPaymentAttemptByOrderAndOrdinal("order-1", ordinal)
      ).rejects.toThrow("INVALID_PAYMENT_ATTEMPT_ORDINAL");
      expect(findUnique).not.toHaveBeenCalled();
    }
  );

  it.each(["", "   ", "order\u0000invalid", "o".repeat(192)])(
    "rejects invalid merchantTradeNo before querying Prisma",
    async (merchantTradeNo) => {
      const { findUnique, store } = createPaymentAttemptReadFixture(null);

      await expect(
        store.findPaymentAttemptByMerchantTradeNo(merchantTradeNo)
      ).rejects.toThrow("INVALID_PAYMENT_ATTEMPT_MERCHANT_TRADE_NO");
      expect(findUnique).not.toHaveBeenCalled();
    }
  );

  it.each(["", "   ", "order\u0000invalid", "o".repeat(192)])(
    "rejects invalid orderId before querying Prisma",
    async (orderId) => {
      const { findUnique, store } = createPaymentAttemptReadFixture(null);

      await expect(
        store.findPaymentAttemptByOrderAndOrdinal(
          orderId,
          INITIAL_PAYMENT_ATTEMPT_ORDINAL
        )
      ).rejects.toThrow("INVALID_PAYMENT_ATTEMPT_ORDER_ID");
      expect(findUnique).not.toHaveBeenCalled();
    }
  );

  it("fails closed when persisted hash bytes do not match BINARY(32)", async () => {
    const { store } = createPaymentAttemptReadFixture(
      paymentAttempt({ providerTradeIdentityHash: Buffer.alloc(31) })
    );

    await expect(
      store.findPaymentAttemptByMerchantTradeNo("order_order-1")
    ).rejects.toThrow("INVALID_PAYMENT_ATTEMPT_PROVIDER_TRADE_IDENTITY_HASH");
  });

  it("fails closed when a 32-byte hash does not match the raw identity", async () => {
    const { store } = createPaymentAttemptReadFixture(
      paymentAttempt({ providerTradeIdentityHash: Buffer.alloc(32, 7) })
    );

    await expect(
      store.findPaymentAttemptByMerchantTradeNo("order_order-1")
    ).rejects.toThrow("INVALID_PAYMENT_ATTEMPT_PROVIDER_TRADE_IDENTITY_HASH");
  });

  it("maps absent Provider trade identity as null without creating a hash", async () => {
    const { store } = createPaymentAttemptReadFixture(
      paymentAttempt({
        providerTradeNo: null,
        providerTradeIdentityHash: null
      })
    );

    await expect(
      store.findPaymentAttemptByMerchantTradeNo("order_order-1")
    ).resolves.toMatchObject({
      providerTradeNo: null,
      providerTradeIdentityHash: null
    });
  });

  it("fails closed when a hash exists without providerTradeNo", async () => {
    const { store } = createPaymentAttemptReadFixture(
      paymentAttempt({
        providerTradeNo: null,
        providerTradeIdentityHash: Uint8Array.from(
          createProviderTradeIdentityHash(providerTradeIdentity)
        )
      })
    );

    await expect(
      store.findPaymentAttemptByMerchantTradeNo("order_order-1")
    ).rejects.toThrow("INVALID_PAYMENT_ATTEMPT_PROVIDER_TRADE_IDENTITY_HASH");
  });

  it("fails closed when providerTradeNo exists without its identity hash", async () => {
    const { store } = createPaymentAttemptReadFixture(
      paymentAttempt({ providerTradeIdentityHash: null })
    );

    await expect(
      store.findPaymentAttemptByMerchantTradeNo("order_order-1")
    ).rejects.toThrow("INVALID_PAYMENT_ATTEMPT_PROVIDER_TRADE_IDENTITY_HASH");
  });
});

describe("Prisma initial PaymentAttempt transaction", () => {
  it("commits the Order mirrors and one ACTIVE ordinal-1 Attempt through the same transaction", async () => {
    const order = initializedPaymentOrder();
    const attempt = initialPaymentAttempt();
    const callOrder: string[] = [];
    const updateMany = vi.fn(async () => {
      callOrder.push("order-cas");
      return { count: 1 };
    });
    const create = vi.fn(async () => {
      callOrder.push("attempt-create");
      return attempt;
    });
    const findUnique = vi.fn(async () => {
      callOrder.push("order-read");
      return order;
    });
    const transaction = vi.fn(
      async (
        operation: (tx: Prisma.TransactionClient) => Promise<unknown>
      ) =>
        operation({
          order: { updateMany, findUnique },
          paymentAttempt: { create }
        } as unknown as Prisma.TransactionClient)
    );
    const store = createPrismaUserStore({
      $transaction: transaction
    } as unknown as PrismaClient);

    await expect(
      store.initializeInitialPaymentAttempt(initialPaymentInput)
    ).resolves.toEqual({
      status: "INITIALIZED",
      order: expect.objectContaining({
        id: initialPaymentInput.orderId,
        paymentProvider: initialPaymentInput.provider,
        paymentType: initialPaymentInput.paymentType,
        paymentTradeNo: initialPaymentInput.merchantTradeNo,
        paymentUrl: initialPaymentInput.paymentUrl
      }),
      attempt: expect.objectContaining({
        orderId: initialPaymentInput.orderId,
        ordinal: INITIAL_PAYMENT_ATTEMPT_ORDINAL,
        provider: initialPaymentInput.provider,
        providerMerchantRef: initialPaymentInput.providerMerchantRef,
        paymentType: initialPaymentInput.paymentType,
        merchantTradeNo: initialPaymentInput.merchantTradeNo,
        providerTradeNo: null,
        providerTradeIdentityHash: null,
        status: "ACTIVE",
        paidAt: null
      })
    });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "ReadCommitted"
    });
    expect(callOrder).toEqual(["order-cas", "attempt-create", "order-read"]);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: initialPaymentInput.orderId,
        status: "PENDING",
        paymentProvider: null,
        paymentType: null,
        paymentTradeNo: null,
        providerTradeNo: null,
        paymentUrl: null,
        paidAt: null
      },
      data: {
        paymentProvider: initialPaymentInput.provider,
        paymentType: initialPaymentInput.paymentType,
        paymentTradeNo: initialPaymentInput.merchantTradeNo,
        paymentUrl: initialPaymentInput.paymentUrl
      }
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        orderId: initialPaymentInput.orderId,
        ordinal: INITIAL_PAYMENT_ATTEMPT_ORDINAL,
        provider: initialPaymentInput.provider,
        providerMerchantRef: initialPaymentInput.providerMerchantRef,
        paymentType: initialPaymentInput.paymentType,
        merchantTradeNo: initialPaymentInput.merchantTradeNo,
        providerTradeNo: null,
        providerTradeIdentityHash: null,
        status: "ACTIVE",
        paidAt: null
      }
    });
  });

  it("does not insert an Attempt when the Order initialization CAS loses", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const create = vi.fn();
    const transaction = vi.fn(
      async (
        operation: (tx: Prisma.TransactionClient) => Promise<unknown>
      ) =>
        operation({
          order: {
            updateMany,
            findUnique: vi.fn().mockResolvedValue(
              paymentOrder({ paymentProvider: "epay" })
            )
          },
          paymentAttempt: {
            create,
            findUnique: vi.fn().mockResolvedValue(null)
          }
        } as unknown as Prisma.TransactionClient)
    );
    const store = createPrismaUserStore({
      $transaction: transaction
    } as unknown as PrismaClient);

    await expect(
      store.initializeInitialPaymentAttempt(initialPaymentInput)
    ).resolves.toEqual({ status: "PAYMENT_REFERENCE_CONFLICT" });
    expect(create).not.toHaveBeenCalled();
  });

  it("rolls back staged Order mirrors when the Attempt insert raises the target P2002", async () => {
    let committedOrder = paymentOrder();
    let stagedOrder = committedOrder;
    const targetConflict = {
      code: "P2002",
      meta: { target: "PaymentAttempt_orderId_ordinal_key" }
    };
    const transaction = vi.fn(
      async (
        operation: (tx: Prisma.TransactionClient) => Promise<unknown>
      ) => {
        const tx = {
          order: {
            updateMany: vi.fn(async () => {
              stagedOrder = initializedPaymentOrder();
              return { count: 1 };
            }),
            findUnique: vi.fn(async () => stagedOrder)
          },
          paymentAttempt: {
            create: vi.fn(async () => {
              throw targetConflict;
            })
          }
        } as unknown as Prisma.TransactionClient;

        try {
          const result = await operation(tx);
          committedOrder = stagedOrder;
          return result;
        } catch (error) {
          stagedOrder = committedOrder;
          throw error;
        }
      }
    );
    const rootOrderRead = vi.fn(async () => committedOrder);
    const rootAttemptRead = vi.fn().mockResolvedValue(null);
    const store = createPrismaUserStore({
      $transaction: transaction,
      order: { findUnique: rootOrderRead },
      paymentAttempt: { findUnique: rootAttemptRead }
    } as unknown as PrismaClient);

    await expect(
      store.initializeInitialPaymentAttempt(initialPaymentInput)
    ).resolves.toEqual({ status: "PAYMENT_REFERENCE_CONFLICT" });
    expect(committedOrder).toMatchObject({
      paymentProvider: null,
      paymentType: null,
      paymentTradeNo: null,
      paymentUrl: null
    });
    expect(rootOrderRead).toHaveBeenCalledTimes(1);
    expect(rootAttemptRead).toHaveBeenCalledTimes(1);
  });

  it("rereads and adopts a fully consistent committed winner after target P2002", async () => {
    const winnerOrder = initializedPaymentOrder();
    const winnerAttempt = initialPaymentAttempt();
    const transaction = vi.fn().mockRejectedValue({
      code: "P2002",
      meta: { target: ["orderId", "ordinal"] }
    });
    const rootOrderRead = vi.fn().mockResolvedValue(winnerOrder);
    const rootAttemptRead = vi.fn().mockResolvedValue(winnerAttempt);
    const store = createPrismaUserStore({
      $transaction: transaction,
      order: { findUnique: rootOrderRead },
      paymentAttempt: { findUnique: rootAttemptRead }
    } as unknown as PrismaClient);

    await expect(
      store.initializeInitialPaymentAttempt(initialPaymentInput)
    ).resolves.toMatchObject({
      status: "EXISTING_COMPATIBLE",
      order: {
        paymentTradeNo: initialPaymentInput.merchantTradeNo,
        paymentUrl: initialPaymentInput.paymentUrl
      },
      attempt: {
        orderId: initialPaymentInput.orderId,
        ordinal: INITIAL_PAYMENT_ATTEMPT_ORDINAL
      }
    });
    expect(rootOrderRead).toHaveBeenCalledTimes(1);
    expect(rootAttemptRead).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the committed winner identity conflicts", async () => {
    const transaction = vi.fn().mockRejectedValue({
      code: "P2002",
      meta: { target: "PaymentAttempt_merchantTradeNo_key" }
    });
    const store = createPrismaUserStore({
      $transaction: transaction,
      order: { findUnique: vi.fn().mockResolvedValue(initializedPaymentOrder()) },
      paymentAttempt: {
        findUnique: vi.fn().mockResolvedValue(
          initialPaymentAttempt({ paymentType: "wxpay" })
        )
      }
    } as unknown as PrismaClient);

    await expect(
      store.initializeInitialPaymentAttempt(initialPaymentInput)
    ).resolves.toEqual({ status: "PAYMENT_REFERENCE_CONFLICT" });
  });

  it("fails closed when the committed winner uses another merchant identity", async () => {
    const transaction = vi.fn().mockRejectedValue({
      code: "P2002",
      meta: { target: "PaymentAttempt_orderId_ordinal_key" }
    });
    const store = createPrismaUserStore({
      $transaction: transaction,
      order: { findUnique: vi.fn().mockResolvedValue(initializedPaymentOrder()) },
      paymentAttempt: {
        findUnique: vi.fn().mockResolvedValue(
          initialPaymentAttempt({ providerMerchantRef: "merchant-old" })
        )
      }
    } as unknown as PrismaClient);

    await expect(
      store.initializeInitialPaymentAttempt(initialPaymentInput)
    ).resolves.toEqual({ status: "PAYMENT_REFERENCE_CONFLICT" });
  });

  it("does not adopt a winner for an unrelated P2002", async () => {
    const transaction = vi.fn().mockRejectedValue({
      code: "P2002",
      meta: { target: "Order_paymentTradeNo_key" }
    });
    const rootOrderRead = vi.fn();
    const rootAttemptRead = vi.fn();
    const store = createPrismaUserStore({
      $transaction: transaction,
      order: { findUnique: rootOrderRead },
      paymentAttempt: { findUnique: rootAttemptRead }
    } as unknown as PrismaClient);

    await expect(
      store.initializeInitialPaymentAttempt(initialPaymentInput)
    ).resolves.toEqual({ status: "PAYMENT_REFERENCE_CONFLICT" });
    expect(rootOrderRead).not.toHaveBeenCalled();
    expect(rootAttemptRead).not.toHaveBeenCalled();
  });
});
