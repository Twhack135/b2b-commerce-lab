import { Prisma } from '../generated/prisma/client';
import { PrismaService } from './prisma.service';

/**
 * Runs `work` in a database transaction that can only read:
 * - REPEATABLE READ: every query sees the same committed snapshot, so data
 *   changed by others during the work cannot mix old and new values
 * - READ ONLY: PostgreSQL itself rejects every write (error 25006), so the
 *   work can never change data, even by mistake
 *
 * Prisma has no option for READ ONLY, so it is set as the first statement;
 * PostgreSQL allows this before the first query of a transaction.
 * Run the queries one after the other (not with Promise.all), because a
 * transaction uses a single connection.
 */
export function readOnlyTransaction<T>(
  prisma: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return work(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
