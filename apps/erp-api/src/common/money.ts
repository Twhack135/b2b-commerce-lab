import { Prisma } from '../generated/prisma/client';

// Monetary amounts in the pricing API are decimal strings such as "4200.50".
// All calculations use Prisma.Decimal, never JavaScript numbers, so values
// like 0.1 + 0.2 are exact.

export type Decimal = Prisma.Decimal;

/** Number of decimal places of all amounts (database: DECIMAL(12, 2)) */
export const AMOUNT_SCALE = 2;

/**
 * Rounds commercially (half up) to two decimal places. Prices and integer
 * quantities never need rounding; this is the single rounding rule for
 * future calculations such as percentage discounts.
 */
export function roundAmount(value: Decimal): Decimal {
  return value.toDecimalPlaces(AMOUNT_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** Amount as API text with exactly two decimal places, e.g. "199.00" */
export function formatAmount(value: Decimal): string {
  return roundAmount(value).toFixed(AMOUNT_SCALE);
}
