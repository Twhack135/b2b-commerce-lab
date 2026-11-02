// Display rules of a stored sales order (order confirmation). Everything is
// shown from the order itself: its snapshots of partners, materials and
// prices, never from current master data or price conditions.

import { formatApiAmount } from "./money.ts";
import type { SalesOrder } from "./sales-orders.ts";

/** Sales order numbers have 10 digits, e.g. 1000000001 */
export function isSalesOrderNumber(text: string): boolean {
  return /^\d{10}$/.test(text);
}

/** The partner functions in the order of an SAP order header */
export const PARTNER_ROLES = [
  ["soldTo", "Sold-to (SP)"],
  ["shipTo", "Ship-to (SH)"],
  ["billTo", "Bill-to (BP)"],
  ["payer", "Payer (PY)"],
] as const satisfies readonly [keyof SalesOrder["partners"], string][];

export const SHIPPING_METHOD_LABELS: Record<SalesOrder["requestedShippingMethod"], string> = {
  STANDARD: "Standard",
  EXPRESS: "Express (requested, not confirmed)",
};

/** An amount of the order in its document currency, e.g. "10,695.00 EUR" */
export function orderAmount(order: SalesOrder, amount: string): string {
  return `${formatApiAmount(amount, order.currencyDecimals)} ${order.currency}`;
}

/** The notice after a creation, from the ?created= parameter of the page */
export function createdNotice(
  salesOrderNumber: string,
  created: string | undefined,
): string | null {
  if (created === "new") return `Sales order ${salesOrderNumber} was created.`;
  if (created === "existing") {
    return `Sales order ${salesOrderNumber} had already been created by this request; no second order was created.`;
  }
  return null;
}

/** Information about the order that the confirmation must state */
export function orderNotes(order: SalesOrder): string[] {
  const notes = [
    "All amounts are net values, excluding tax and freight.",
    `Prices as determined on the order date ${order.orderDate} (${order.timeZone}); later price changes do not change this order.`,
  ];
  if (order.requestedDeliveryDate) {
    notes.push(
      `The requested delivery date ${order.requestedDeliveryDate} is a request of the customer, not a confirmed delivery date.`,
    );
  }
  if (order.requestedShippingMethod === "EXPRESS") {
    notes.push("Express shipping was requested; it is not confirmed and not charged.");
  }
  notes.push(
    "Stock availability, delivery date, freight, tax and credit have not been checked.",
  );
  return notes;
}
