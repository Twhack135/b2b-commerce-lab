import { Prisma } from '../generated/prisma/client';

// Monetary amounts in the pricing API are decimal strings such as "4200.50".
// All calculations use Prisma.Decimal, never JavaScript numbers, so values
// like 0.1 + 0.2 are exact.

export type Decimal = Prisma.Decimal;

/**
 * Number of decimal places of all amounts the pricing engine handles today
 * (database: DECIMAL(12, 2)). EUR has 2 decimal places; currencies with
 * other precision use the currency functions below.
 */
export const AMOUNT_SCALE = 2;

/**
 * Rounds commercially (half up) to two decimal places. Prices and integer
 * quantities never need rounding; this is the single rounding rule for
 * future calculations such as percentage discounts.
 */
export function roundAmount(value: Decimal): Decimal {
  return roundToCurrency(value, { decimals: AMOUNT_SCALE });
}

/** Amount as API text with exactly two decimal places, e.g. "199.00" */
export function formatAmount(value: Decimal): string {
  return formatInCurrency(value, { decimals: AMOUNT_SCALE });
}

// ---------------------------------------------------------------------------
// Currency precision (configured per currency in the currencies table,
// comparable to SAP TCURX): EUR and PLN have 2 decimal places, JPY has 0.
// The database stores the real value: 700000 JPY is 700000.00 in a
// DECIMAL(12, 2) column, so it fits every currency with up to 2 decimals.
// ---------------------------------------------------------------------------

/** The part of a currency that the amount rules need */
export interface CurrencyPrecision {
  decimals: number;
}

/** Rounds commercially (half up) to the decimal places of the currency */
export function roundToCurrency(
  value: Decimal,
  currency: CurrencyPrecision,
): Decimal {
  return value.toDecimalPlaces(currency.decimals, Prisma.Decimal.ROUND_HALF_UP);
}

/** Amount as API text, e.g. "199.00" for EUR and "700000" for JPY */
export function formatInCurrency(
  value: Decimal,
  currency: CurrencyPrecision,
): string {
  return roundToCurrency(value, currency).toFixed(currency.decimals);
}

/**
 * Does the amount fit the decimal places of the currency? Trailing zeros do
 * not count: 4400.00 fits JPY, 4400.50 does not. Amounts that do not fit
 * are rejected, never rounded silently.
 */
export function fitsCurrency(
  value: Decimal,
  currency: CurrencyPrecision,
): boolean {
  return value.decimalPlaces() <= currency.decimals;
}

/** Validation message for an amount that does not fit, or null */
export function currencyPrecisionError(
  field: string,
  value: Decimal,
  currency: CurrencyPrecision & { code: string },
): string | null {
  if (fitsCurrency(value, currency)) return null;
  return currency.decimals === 0
    ? `${field} must be a whole amount: ${currency.code} has no decimal places`
    : `${field} must have at most ${currency.decimals} decimal places for ${currency.code}`;
}
