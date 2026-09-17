import type {
  AccountCreditEvent,
  OrderStatus,
  Prisma,
  PrismaClient
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { createPrismaUserStore } from "../src/store";

type FinancialOrder = Prisma.OrderGetPayload<{
  include: { plan: true; user: true };
}>;

interface FinancialState {
  order: FinancialOrder | null;
  remainingCredits: number;
  creditEvents: AccountCreditEvent[];
}

interface FinancialStoreFixtureOptions {
  beforeCancelCas?: () => Promise<void>;
  forceCancelCasMiss?: boolean;
  initialStatus?: OrderStatus;
  orderExists?: boolean;
}

function createFinancialOrder(status: OrderStatus = "PENDING"): FinancialOrder {
  const paidAt = status === "PAID" ? new Date("2030-01-01T00:00:00.000Z") : null;

  return {
    id: "order-1",
    userId: "user-1",
    planId: "plan-1",
    amount: 990,
    credits: 100,
    status,
    paymentProvider: "epay",
    paymentType: "alipay",
    paymentTradeNo: "order_order-1",
    providerTradeNo: status === "PAID" ? "Y-PAID" : null,
    paymentUrl: "https://pay.example.test/submit.php",
    paidAt,
    createdAt: new Date("2029-12-31T00:00:00.000Z"),
    updatedAt: paidAt ?? new Date("2029-12-31T00:00:00.000Z"),
    plan: {
      id: "plan-1",
      name: "Starter",
      slug: null,
      price: 990,
      credits: 100,
      description: null,
      features: [],
      enabled: true,
      sortOrder: 1,
      highlighted: false,
      createdAt: new Date("2029-01-01T00:00:00.000Z"),
      updatedAt: new Date("2029-01-01T00:00:00.000Z")
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
      createdAt: new Date("2029-01-01T00:00:00.000Z"),
      updatedAt: new Date("2029-01-01T00:00:00.000Z")
    }
  };
}

function createFinancialStoreFixture(
  options: FinancialStoreFixtureOptions = {}
) {
  const state: FinancialState = {
    order:
      options.orderExists === false
        ? null
        : createFinancialOrder(options.initialStatus),
    remainingCredits: 20,
    creditEvents: []
  };
  const legacyOrderUpdate = vi.fn();

  const findOrder = vi.fn(
    async (args?: { where?: { id?: string; userId?: string } }) => {
      if (
        !state.order ||
        (args?.where?.id !== undefined &&
          state.order.id !== args.where.id) ||
        (args?.where?.userId !== undefined &&
          state.order.userId !== args.where.userId)
      ) {
        return null;
      }
      return state.order;
    }
  );
  const updateOrderMany = vi.fn(
    async (args: {
      where: { id: string; userId?: string; status: OrderStatus };
      data: {
        status: OrderStatus;
        paidAt?: Date | null;
        providerTradeNo?: string;
      };
    }) => {
      if (args.data.status === "CANCELLED") {
        await options.beforeCancelCas?.();
        if (options.forceCancelCasMiss) {
          return { count: 0 };
        }
      }

      if (
        !state.order ||
        state.order.id !== args.where.id ||
        (args.where.userId !== undefined &&
          state.order.userId !== args.where.userId) ||
        state.order.status !== args.where.status
      ) {
        return { count: 0 };
      }

      state.order = {
        ...state.order,
        status: args.data.status,
        ...(args.data.paidAt !== undefined
          ? { paidAt: args.data.paidAt }
          : {}),
        ...(args.data.providerTradeNo !== undefined
          ? { providerTradeNo: args.data.providerTradeNo }
          : {}),
        updatedAt: args.data.paidAt ?? new Date("2030-01-01T00:01:00.000Z")
      };
      return { count: 1 };
    }
  );

  const accountCreditEventFind = vi.fn(
    async (args: { where: { idempotencyKey: string } }) =>
      state.creditEvents.find(
        (event) => event.idempotencyKey === args.where.idempotencyKey
      ) ?? null
  );
  const accountCreditEventCreate = vi.fn(
    async (args: { data: Omit<AccountCreditEvent, "id" | "createdAt"> }) => {
      const event: AccountCreditEvent = {
        id: `credit-event-${state.creditEvents.length + 1}`,
        ...args.data,
        createdAt: new Date("2030-01-01T00:00:00.000Z")
      };
      state.creditEvents.push(event);
      return event;
    }
  );

  const transaction = vi.fn(
    async (
      operation: (tx: Prisma.TransactionClient) => Promise<unknown>
    ) => {
      let rawQueryCount = 0;
      const tx = {
        order: {
          findUnique: findOrder,
          updateMany: updateOrderMany
        },
        userQuota: {
          create: vi.fn(async (args: { data: { remainingCredits: number } }) => {
            state.remainingCredits = args.data.remainingCredits;
            return {
              id: "quota-1",
              userId: "user-1",
              remainingCredits: state.remainingCredits,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          }),
          update: vi.fn(async (args: { data: { remainingCredits: number } }) => {
            state.remainingCredits = args.data.remainingCredits;
            return {
              id: "quota-1",
              userId: "user-1",
              remainingCredits: state.remainingCredits,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          })
        },
        accountCreditEvent: {
          findUnique: accountCreditEventFind,
          create: accountCreditEventCreate
        },
        $queryRaw: vi.fn(async () => {
          rawQueryCount += 1;
          return rawQueryCount === 1
            ? [{ id: "user-1" }]
            : [{ userId: "user-1", remainingCredits: state.remainingCredits }];
        })
      } as unknown as Prisma.TransactionClient;

      return operation(tx);
    }
  );

  const client = {
    order: {
      findFirst: findOrder,
      findUnique: findOrder,
      updateMany: updateOrderMany,
      update: legacyOrderUpdate
    },
    $transaction: transaction
  } as unknown as PrismaClient;

  return {
    state,
    store: createPrismaUserStore(client),
    findOrder,
    updateOrderMany,
    legacyOrderUpdate,
    transaction
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("Prisma Admin Order cancellation CAS", () => {
  it("atomically changes PENDING to CANCELLED without the legacy id-only update", async () => {
    const fixture = createFinancialStoreFixture();

    await expect(
      fixture.store.updateOrderStatus("order-1", "CANCELLED")
    ).resolves.toMatchObject({ status: "CANCELLED", paidAt: null });

    expect(fixture.updateOrderMany).toHaveBeenCalledWith({
      where: { id: "order-1", status: "PENDING" },
      data: { status: "CANCELLED", paidAt: null }
    });
    expect(fixture.legacyOrderUpdate).not.toHaveBeenCalled();
    expect(fixture.state.order?.status).toBe("CANCELLED");
  });

  it("returns an existing CANCELLED Order idempotently without another write", async () => {
    const fixture = createFinancialStoreFixture({ initialStatus: "CANCELLED" });

    await expect(
      fixture.store.updateOrderStatus("order-1", "CANCELLED")
    ).resolves.toMatchObject({ status: "CANCELLED" });
    expect(fixture.updateOrderMany).not.toHaveBeenCalled();
  });

  it("adopts a concurrent CANCELLED winner after its own CAS misses", async () => {
    let fixture!: ReturnType<typeof createFinancialStoreFixture>;
    fixture = createFinancialStoreFixture({
      async beforeCancelCas() {
        if (!fixture.state.order) {
          throw new Error("TEST_ORDER_MISSING");
        }
        fixture.state.order = {
          ...fixture.state.order,
          status: "CANCELLED",
          paidAt: null
        };
      }
    });

    await expect(
      fixture.store.updateOrderStatus("order-1", "CANCELLED")
    ).resolves.toMatchObject({ status: "CANCELLED" });
    expect(fixture.updateOrderMany).toHaveBeenCalledTimes(1);
    expect(fixture.legacyOrderUpdate).not.toHaveBeenCalled();
  });

  it("preserves PAID-cannot-cancel and the dedicated Admin PAID path", async () => {
    const paid = createFinancialStoreFixture({ initialStatus: "PAID" });
    const pending = createFinancialStoreFixture();

    await expect(
      paid.store.updateOrderStatus("order-1", "CANCELLED")
    ).rejects.toThrow("ORDER_PAID_CANNOT_BE_CANCELLED");
    await expect(
      pending.store.updateOrderStatus("order-1", "PAID")
    ).rejects.toThrow("ADMIN_PAID_REQUIRES_FINANCIAL_CONTEXT");
    expect(paid.updateOrderMany).not.toHaveBeenCalled();
    expect(pending.updateOrderMany).not.toHaveBeenCalled();
  });

  it("lets payment win after Admin observed PENDING without a stale CANCELLED overwrite", async () => {
    const cancelCasEntered = deferred();
    const releaseCancelCas = deferred();
    const fixture = createFinancialStoreFixture({
      async beforeCancelCas() {
        cancelCasEntered.resolve();
        await releaseCancelCas.promise;
      }
    });
    const cancel = fixture.store.updateOrderStatus("order-1", "CANCELLED");
    const cancelExpectation = expect(cancel).rejects.toThrow(
      "ORDER_PAID_CANNOT_BE_CANCELLED"
    );

    await cancelCasEntered.promise;
    await expect(
      fixture.store.confirmPaidOrderFromPayment("order-1", {
        providerTradeNo: "Y-PAYMENT-WINS",
        paymentType: "alipay",
        paidAt: new Date("2030-01-01T00:02:00.000Z")
      })
    ).resolves.toMatchObject({ status: "PAID", alreadyPaid: false });
    releaseCancelCas.resolve();
    await cancelExpectation;

    expect(fixture.state.order).toMatchObject({
      status: "PAID",
      providerTradeNo: "Y-PAYMENT-WINS"
    });
    expect(fixture.state.remainingCredits).toBe(120);
    expect(fixture.state.creditEvents).toHaveLength(1);
    expect(fixture.state.creditEvents[0]).toMatchObject({
      sourceType: "PAYMENT_PAID",
      idempotencyKey: "payment-paid:order-1"
    });
    expect(fixture.legacyOrderUpdate).not.toHaveBeenCalled();
  });

  it("lets cancellation win so payment cannot grant credits or an event", async () => {
    const fixture = createFinancialStoreFixture();

    await expect(
      fixture.store.updateOrderStatus("order-1", "CANCELLED")
    ).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(
      fixture.store.confirmPaidOrderFromPayment("order-1", {
        providerTradeNo: "Y-CANCEL-LOST",
        paymentType: "alipay",
        paidAt: new Date("2030-01-01T00:02:00.000Z")
      })
    ).resolves.toEqual({
      status: "INVALID_ORDER_STATE",
      order: null,
      alreadyPaid: false
    });

    expect(fixture.state.order).toMatchObject({
      status: "CANCELLED",
      providerTradeNo: null,
      paidAt: null
    });
    expect(fixture.state.remainingCredits).toBe(20);
    expect(fixture.state.creditEvents).toEqual([]);
  });

  it("fails closed when the CAS misses but the authoritative Order is still PENDING", async () => {
    const fixture = createFinancialStoreFixture({ forceCancelCasMiss: true });

    await expect(
      fixture.store.updateOrderStatus("order-1", "CANCELLED")
    ).rejects.toThrow("ORDER_STATUS_CONCURRENCY_CONFLICT");
    expect(fixture.state.order?.status).toBe("PENDING");
    expect(fixture.updateOrderMany).toHaveBeenCalledTimes(1);
    expect(fixture.legacyOrderUpdate).not.toHaveBeenCalled();
  });

  it("preserves not-found behavior", async () => {
    const fixture = createFinancialStoreFixture({ orderExists: false });

    await expect(
      fixture.store.updateOrderStatus("missing-order", "CANCELLED")
    ).resolves.toBeNull();
    expect(fixture.updateOrderMany).not.toHaveBeenCalled();
  });
});

describe("Prisma user-owned Order cancellation CAS", () => {
  it("atomically changes only the owner's PENDING Order to CANCELLED", async () => {
    const fixture = createFinancialStoreFixture();

    await expect(
      fixture.store.cancelPendingOrderForUser({
        orderId: "order-1",
        userId: "user-1"
      })
    ).resolves.toMatchObject({
      status: "CANCELLED",
      alreadyCancelled: false,
      order: { status: "CANCELLED", paidAt: null }
    });

    expect(fixture.updateOrderMany).toHaveBeenCalledWith({
      where: {
        id: "order-1",
        userId: "user-1",
        status: "PENDING"
      },
      data: { status: "CANCELLED" }
    });
    expect(fixture.legacyOrderUpdate).not.toHaveBeenCalled();
    expect(fixture.state.remainingCredits).toBe(20);
    expect(fixture.state.creditEvents).toEqual([]);
  });

  it("returns an owned CANCELLED Order idempotently without another write", async () => {
    const fixture = createFinancialStoreFixture({ initialStatus: "CANCELLED" });

    await expect(
      fixture.store.cancelPendingOrderForUser({
        orderId: "order-1",
        userId: "user-1"
      })
    ).resolves.toMatchObject({
      status: "CANCELLED",
      alreadyCancelled: true,
      order: { status: "CANCELLED" }
    });
    expect(fixture.updateOrderMany).not.toHaveBeenCalled();
  });

  it("rejects an owned PAID Order without changing financial state", async () => {
    const fixture = createFinancialStoreFixture({ initialStatus: "PAID" });
    const paidAt = fixture.state.order?.paidAt;

    await expect(
      fixture.store.cancelPendingOrderForUser({
        orderId: "order-1",
        userId: "user-1"
      })
    ).resolves.toEqual({
      status: "ORDER_PAID_CANNOT_BE_CANCELLED",
      order: null
    });
    expect(fixture.state.order).toMatchObject({ status: "PAID", paidAt });
    expect(fixture.updateOrderMany).not.toHaveBeenCalled();
  });

  it("does not disclose or mutate another user's Order", async () => {
    const fixture = createFinancialStoreFixture();

    await expect(
      fixture.store.cancelPendingOrderForUser({
        orderId: "order-1",
        userId: "user-2"
      })
    ).resolves.toEqual({
      status: "NOT_FOUND_OR_NOT_OWNED",
      order: null
    });
    expect(fixture.state.order?.status).toBe("PENDING");
    expect(fixture.updateOrderMany).not.toHaveBeenCalled();
  });

  it("fails closed when its CAS misses and the owned Order remains PENDING", async () => {
    const fixture = createFinancialStoreFixture({ forceCancelCasMiss: true });

    await expect(
      fixture.store.cancelPendingOrderForUser({
        orderId: "order-1",
        userId: "user-1"
      })
    ).resolves.toEqual({
      status: "ORDER_STATUS_CONCURRENCY_CONFLICT",
      order: null
    });
    expect(fixture.state.order?.status).toBe("PENDING");
    expect(fixture.updateOrderMany).toHaveBeenCalledTimes(1);
    expect(fixture.legacyOrderUpdate).not.toHaveBeenCalled();
  });

  it("preserves PAID when payment wins after the user cancellation pre-read", async () => {
    const cancelCasEntered = deferred();
    const releaseCancelCas = deferred();
    const fixture = createFinancialStoreFixture({
      async beforeCancelCas() {
        cancelCasEntered.resolve();
        await releaseCancelCas.promise;
      }
    });
    const cancel = fixture.store.cancelPendingOrderForUser({
      orderId: "order-1",
      userId: "user-1"
    });

    await cancelCasEntered.promise;
    await expect(
      fixture.store.confirmPaidOrderFromPayment("order-1", {
        providerTradeNo: "Y-USER-CANCEL-PAYMENT-WINS",
        paymentType: "alipay",
        paidAt: new Date("2030-01-01T00:02:00.000Z")
      })
    ).resolves.toMatchObject({ status: "PAID", alreadyPaid: false });
    releaseCancelCas.resolve();

    await expect(cancel).resolves.toEqual({
      status: "ORDER_PAID_CANNOT_BE_CANCELLED",
      order: null
    });
    expect(fixture.state.order).toMatchObject({
      status: "PAID",
      providerTradeNo: "Y-USER-CANCEL-PAYMENT-WINS"
    });
    expect(fixture.state.remainingCredits).toBe(120);
    expect(fixture.state.creditEvents).toHaveLength(1);
  });

  it("keeps CANCELLED and grants nothing when the user cancellation wins", async () => {
    const fixture = createFinancialStoreFixture();

    await expect(
      fixture.store.cancelPendingOrderForUser({
        orderId: "order-1",
        userId: "user-1"
      })
    ).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(
      fixture.store.confirmPaidOrderFromPayment("order-1", {
        providerTradeNo: "Y-USER-CANCEL-WINS",
        paymentType: "alipay",
        paidAt: new Date("2030-01-01T00:02:00.000Z")
      })
    ).resolves.toEqual({
      status: "INVALID_ORDER_STATE",
      order: null,
      alreadyPaid: false
    });

    expect(fixture.state.order).toMatchObject({
      status: "CANCELLED",
      providerTradeNo: null,
      paidAt: null
    });
    expect(fixture.state.remainingCredits).toBe(20);
    expect(fixture.state.creditEvents).toEqual([]);
  });

  it("preserves a generic not-found result", async () => {
    const fixture = createFinancialStoreFixture({ orderExists: false });

    await expect(
      fixture.store.cancelPendingOrderForUser({
        orderId: "missing-order",
        userId: "user-1"
      })
    ).resolves.toEqual({
      status: "NOT_FOUND_OR_NOT_OWNED",
      order: null
    });
    expect(fixture.updateOrderMany).not.toHaveBeenCalled();
  });
});
