import { Prisma } from '../generated/prisma/client';

// Prisma error codes, see https://www.prisma.io/docs/orm/reference/error-reference
export const UNIQUE_CONSTRAINT_FAILED = 'P2002';
export const RECORD_NOT_FOUND = 'P2025';

export function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
