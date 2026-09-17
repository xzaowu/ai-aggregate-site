import { Prisma } from "@prisma/client";
import {
  adminOperationsBudgetScopes,
  type AdminOperationsBudget,
  type AdminOperationsBudgetScope,
  type AdminOperationsBudgetStatus
} from "@ai-aggregate/shared";
import { getUtcDailyBudgetPeriodKey } from "./global-budget";
import {
  getPrismaClient,
  type ConsumeGlobalBudgetInput,
  type ConsumeGlobalBudgetResult,
  type GlobalBudgetStore
} from "./store";

interface GlobalBudgetPrismaClient {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options?: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
    }
  ): Promise<Result>;
  $queryRaw?<Result>(query: Prisma.Sql): Promise<Result>;
}

export interface AdminGlobalBudgetReadStore {
  listAdminBudgetPeriods(now?: Date): Promise<AdminOperationsBudget[]>;
}

interface LockedGlobalBudgetRow {
  budgetCredits: bigint;
  consumedCredits: bigint;
}

interface AdminGlobalBudgetRow {
  scope: string;
  periodType: string;
  periodKey: string;
  budgetCredits: bigint;
  consumedCredits: bigint;
  updatedAt: Date;
}

function emptyAdminBudget(scope: AdminOperationsBudgetScope): AdminOperationsBudget {
  return {
    scope,
    periodType: null,
    periodKey: null,
    limit: null,
    used: null,
    remaining: null,
    status: "NOT_INITIALIZED",
    updatedAt: null
  };
}

function toSafeCreditNumber(value: bigint): number | null {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : null;
}

function getAdminBudgetStatus(
  used: number,
  limit: number
): AdminOperationsBudgetStatus {
  if (used >= limit) {
    return "EXHAUSTED";
  }
  return used / limit >= 0.8 ? "NEAR_LIMIT" : "NORMAL";
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidUtcDailyPeriodKey(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth =
    month === 2
      ? isLeapYear(year)
        ? 29
        : 28
      : month === 4 || month === 6 || month === 9 || month === 11
        ? 30
        : 31;
  return day <= daysInMonth;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function isValidConsumeGlobalBudgetInput(
  input: unknown
): input is ConsumeGlobalBudgetInput {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  const candidate = input as Record<string, unknown>;
  return (
    (candidate.scope === "image_generation" ||
      candidate.scope === "chat_completion" ||
      candidate.scope === "admin_provider_test" ||
      candidate.scope === "title_cover_visual_brief") &&
    candidate.periodType === "DAILY" &&
    isValidUtcDailyPeriodKey(candidate.periodKey) &&
    isPositiveSafeInteger(candidate.budgetCredits) &&
    isPositiveSafeInteger(candidate.costCredits) &&
    candidate.costCredits <= candidate.budgetCredits
  );
}

export function createPrismaGlobalBudgetStore(
  client: GlobalBudgetPrismaClient = getPrismaClient()
): GlobalBudgetStore & AdminGlobalBudgetReadStore {
  return {
    async listAdminBudgetPeriods(now = new Date()): Promise<AdminOperationsBudget[]> {
      const periodKey = getUtcDailyBudgetPeriodKey(now);
      const empty = adminOperationsBudgetScopes.map(emptyAdminBudget);
      if (!client.$queryRaw) {
        return empty;
      }

      try {
        const rows = await client.$queryRaw<AdminGlobalBudgetRow[]>(Prisma.sql`
          SELECT
            \`scope\`,
            \`periodType\`,
            \`periodKey\`,
            \`budgetCredits\`,
            \`consumedCredits\`,
            \`updatedAt\`
          FROM \`GlobalBudgetPeriod\`
          WHERE
            \`scope\` IN (${Prisma.join(adminOperationsBudgetScopes)})
            AND \`periodType\` = ${"DAILY"}
            AND \`periodKey\` = ${periodKey}
        `);
        const byScope = new Map(
          rows.map((row) => [row.scope, row] as const)
        );

        return adminOperationsBudgetScopes.map((scope) => {
          const row = byScope.get(scope);
          if (
            !row ||
            row.periodType !== "DAILY" ||
            row.periodKey !== periodKey ||
            !(row.updatedAt instanceof Date) ||
            !Number.isFinite(row.updatedAt.getTime())
          ) {
            return emptyAdminBudget(scope);
          }

          const limit = toSafeCreditNumber(row.budgetCredits);
          const used = toSafeCreditNumber(row.consumedCredits);
          if (limit === null || used === null || limit <= 0 || used < 0) {
            return emptyAdminBudget(scope);
          }

          return {
            scope,
            periodType: "DAILY" as const,
            periodKey,
            limit,
            used,
            remaining: Math.max(0, limit - used),
            status: getAdminBudgetStatus(used, limit),
            updatedAt: row.updatedAt.toISOString()
          };
        });
      } catch {
        return empty;
      }
    },
    async consumeGlobalBudget(
      input: ConsumeGlobalBudgetInput
    ): Promise<ConsumeGlobalBudgetResult> {
      if (!isValidConsumeGlobalBudgetInput(input)) {
        return { status: "unavailable" };
      }

      const budgetCredits = BigInt(input.budgetCredits);
      const costCredits = BigInt(input.costCredits);

      try {
        return await client.$transaction(
          async (transaction) => {
            await transaction.$executeRaw(
              Prisma.sql`
                INSERT INTO \`GlobalBudgetPeriod\` (
                  \`scope\`,
                  \`periodType\`,
                  \`periodKey\`,
                  \`budgetCredits\`,
                  \`consumedCredits\`,
                  \`createdAt\`,
                  \`updatedAt\`
                ) VALUES (
                  ${input.scope},
                  ${input.periodType},
                  ${input.periodKey},
                  ${budgetCredits},
                  ${0n},
                  CURRENT_TIMESTAMP(3),
                  CURRENT_TIMESTAMP(3)
                )
                ON DUPLICATE KEY UPDATE \`scope\` = \`scope\`
              `
            );

            const rows = await transaction.$queryRaw<LockedGlobalBudgetRow[]>(
              Prisma.sql`
                SELECT \`budgetCredits\`, \`consumedCredits\`
                FROM \`GlobalBudgetPeriod\`
                WHERE
                  \`scope\` = ${input.scope}
                  AND \`periodType\` = ${input.periodType}
                  AND \`periodKey\` = ${input.periodKey}
                FOR UPDATE
              `
            );
            const row = rows[0];
            if (
              rows.length !== 1 ||
              !row ||
              typeof row.budgetCredits !== "bigint" ||
              typeof row.consumedCredits !== "bigint"
            ) {
              throw new Error("GLOBAL_BUDGET_ROW_UNAVAILABLE");
            }

            if (row.budgetCredits !== budgetCredits) {
              return { status: "unavailable" } as const;
            }

            const nextConsumedCredits = row.consumedCredits + costCredits;
            if (nextConsumedCredits > row.budgetCredits) {
              return { status: "exhausted" } as const;
            }

            await transaction.globalBudgetPeriod.update({
              where: {
                scope_periodType_periodKey: {
                  scope: input.scope,
                  periodType: input.periodType,
                  periodKey: input.periodKey
                }
              },
              data: {
                consumedCredits: { increment: costCredits }
              }
            });

            return { status: "consumed" } as const;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        );
      } catch {
        return { status: "unavailable" };
      }
    }
  };
}
