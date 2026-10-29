// Monetary amounts are decimal strings such as "4200.50", exactly as the ERP
// pricing API sends them. These helpers only work on the text and never
// convert amounts to JavaScript numbers, so no floating-point error can
// change a price (0.1 + 0.2 is 0.30000000000000004 as a number).
// This file has no imports, so it can be tested directly with `node --test`.

/** At most 10 digits before the point, as in the database column DECIMAL(12, 2) */
const MAX_INTEGER_DIGITS = 10;

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

/** The validation error of an amount input, or undefined if it is valid */
export function amountError(text: string): string | undefined {
  if (text.trim() === "") return "Amount is required.";
  const parts = splitInput(text);
  if (!parts) return "Enter an amount, for example 4200.50.";
  if (parts.fraction.length > 2) return "Use at most two decimal places.";
  if (parts.integer.length > MAX_INTEGER_DIGITS) {
    return "Amount must not exceed 9,999,999,999.99.";
  }
  if (!/[1-9]/.test(parts.integer + parts.fraction)) {
    return "Amount must be greater than 0.";
  }
  return undefined;
}

/**
 * The amount in the form the ERP API expects, e.g. "4200,5" -> "4200.50".
 * Only call this for an input that passed amountError.
 */
export function normalizeAmount(text: string): string {
  const parts = splitInput(text);
  if (!parts) throw new Error(`Not an amount: ${text}`);
  return `${parts.integer}.${parts.fraction.padEnd(2, "0")}`;
}

/** "4200.50" -> "4,200.50"; other text is returned unchanged */
export function formatAmount(amount: string): string {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(amount);
  if (!match) return amount;
  const [, sign, integer, fraction] = match;
  return `${sign}${integer.replace(/\B(?=(\d{3})+$)/g, ",")}.${fraction}`;
}
