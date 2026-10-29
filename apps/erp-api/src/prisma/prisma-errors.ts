import { Prisma } from '../generated/prisma/client';

// Prisma error codes, see https://www.prisma.io/docs/orm/reference/error-reference
export const UNIQUE_CONSTRAINT_FAILED = 'P2002';
export const FOREIGN_KEY_FAILED = 'P2003';
export const RECORD_NOT_FOUND = 'P2025';

export function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

// PostgreSQL error codes that Prisma has no own code for
export const EXCLUSION_VIOLATION = '23P01';

/**
 * Checks the original PostgreSQL error code. Prisma reports database errors
 * it does not know (such as exclusion constraint violations) with a generic
 * code and keeps the original code in meta.driverAdapterError.
 */
export function isPostgresError(error: unknown, code: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const adapterError = error.meta?.driverAdapterError as
    { cause?: { originalCode?: unknown } } | undefined;
  return adapterError?.cause?.originalCode === code;
}
