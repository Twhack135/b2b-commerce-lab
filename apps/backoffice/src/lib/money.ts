// Monetary amounts are decimal strings such as "4200.50", exactly as the ERP
// pricing API sends them. These helpers only work on the text and never
// convert amounts to JavaScript numbers, so no floating-point error can
// change a price (0.1 + 0.2 is 0.30000000000000004 as a number).
// This file has no imports, so it can be tested directly with `node --test`.
//
// The number of decimal places comes from the currency (ERP API
// /currencies and /sales-areas): EUR and PLN have 2, JPY has 0. Without it,
// 2 is used, which is the current EUR behaviour of all pricing screens.

/** At most 10 digits before the point, as in the database column DECIMAL(12, 2) */
const MAX_INTEGER_DIGITS = 10;

const DEFAULT_DECIMALS = 2;

function splitInput(text: string) {
  // Accepts "4200.50" and "4200,50"
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim().replace(",", "."));
  if (!match) return null;
  return {
    // Leading zeros are removed, the ERP API does not accept them
    integer: match[1].replace(/^0+(?=\d)/, ""),
    fraction: match[2] ?? "",
  };
}

const DECIMAL_WORDS = ["no", "one", "two", "three"];

/** The validation error of an amount input, or undefined if it is valid */
export function amountError(
  text: string,
  decimals: number = DEFAULT_DECIMALS,
): string | undefined {
  if (text.trim() === "") return "Amount is required.";
  const parts = splitInput(text);
  if (!parts) {
    return decimals === 0
      ? "Enter an amount, for example 4200."
      : "Enter an amount, for example 4200.50.";
  }
  if (parts.fraction.length > decimals) {
    return decimals === 0
      ? "Enter a whole amount: this currency has no decimal places."
      : `Use at most ${DECIMAL_WORDS[decimals] ?? decimals} decimal places.`;
  }
  if (parts.integer.length > MAX_INTEGER_DIGITS) {
    return `Amount must not exceed ${formatAmount(maxAmount(decimals), decimals)}.`;
  }
  if (!/[1-9]/.test(parts.integer + parts.fraction)) {
    return "Amount must be greater than 0.";
  }
  return undefined;
}

function maxAmount(decimals: number) {
  const integer = "9".repeat(MAX_INTEGER_DIGITS);
  return decimals === 0 ? integer : `${integer}.${"9".repeat(decimals)}`;
}

/**
 * The amount in the form the ERP API expects, e.g. "4200,5" -> "4200.50"
 * (2 decimal places) or "4200" -> "4200" (0 decimal places).
 * Only call this for an input that passed amountError.
 */
export function normalizeAmount(
  text: string,
  decimals: number = DEFAULT_DECIMALS,
): string {
  const parts = splitInput(text);
  if (!parts) throw new Error(`Not an amount: ${text}`);
  if (decimals === 0) return parts.integer;
  return `${parts.integer}.${parts.fraction.padEnd(decimals, "0")}`;
}

/**
 * "4200.50" -> "4,200.50"; with 0 decimal places "700000" -> "700,000".
 * Text that does not have exactly the given decimal places is returned
 * unchanged, so a wrong amount is never shown as a plausible one.
 */
export function formatAmount(
  amount: string,
  decimals: number = DEFAULT_DECIMALS,
): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match) return amount;
  const [, sign, integer, fraction = ""] = match;
  if (fraction.length !== decimals) return amount;
  const grouped = integer.replace(/\B(?=(\d{3})+$)/g, ",");
  return decimals === 0
    ? `${sign}${grouped}`
    : `${sign}${grouped}.${fraction}`;
}
