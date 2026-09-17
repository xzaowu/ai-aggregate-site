import { Prisma } from "@prisma/client";

const DEFAULT_RETRY_DELAYS_MS = [20, 50, 100] as const;

export function isPrismaWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function retryPrismaWriteConflict(
  operation: () => Promise<void>,
  options: {
    delaysMs?: readonly number[];
  } = {}
): Promise<void> {
  const delaysMs = (options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS).slice(0, 3);

  for (let attempt = 0; ; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      const retryDelayMs = delaysMs[attempt];
      if (!isPrismaWriteConflict(error) || retryDelayMs === undefined) {
        throw error;
      }
      await wait(retryDelayMs);
    }
  }
}
