// Form and display logic of the Price Check panel.
// Only type imports and import-free helpers, so it can be tested directly
// with `node --test`.
import { isCalendarDate } from "./dates.ts";
import type { PriceRequest, PricingSource, PricingStep } from "./pricing.ts";

export const MAX_QUANTITY = 99_999;

export type PriceCheckValues = {
  materialNumber: string;
  unitId: string;
  pricingDate: string;
  /** Text input; a whole number of pieces */
  quantity: string;
};

export type PriceCheckField = keyof PriceCheckValues;

export type PriceCheckErrors = Partial<Record<PriceCheckField, string>>;

export const PRICE_CHECK_FIELDS: PriceCheckField[] = [
  "materialNumber",
  "unitId",
  "pricingDate",
  "quantity",
];

export function validatePriceCheck(values: PriceCheckValues): PriceCheckErrors {
  const errors: PriceCheckErrors = {};
  if (values.materialNumber === "") errors.materialNumber = "Select a material.";
  if (values.unitId === "") errors.unitId = "Select a B2B unit.";
  if (values.pricingDate === "") {
    errors.pricingDate = "Pricing date is required.";
  } else if (!isCalendarDate(values.pricingDate)) {
    errors.pricingDate = "Enter a valid date.";
  }
  const quantity = values.quantity.trim();
  if (quantity === "") {
    errors.quantity = "Quantity is required.";
  } else if (!/^\d+$/.test(quantity)) {
    errors.quantity = "Enter a whole number of pieces.";
  } else if (Number(quantity) < 1 || Number(quantity) > MAX_QUANTITY) {
    errors.quantity = `Quantity must be between 1 and ${MAX_QUANTITY.toLocaleString("en-US")}.`;
  }
  return errors;
}

/** Only call this for values without errors */
export function toPriceRequest(values: PriceCheckValues): PriceRequest {
  return {
    materialNumber: values.materialNumber,
    unitId: values.unitId,
    pricingDate: values.pricingDate,
    // A count of pieces, not money: a whole number is exact as a number
    quantity: Number(values.quantity.trim()),
  };
}

export const SOURCE_LABELS: Record<PricingSource, string> = {
  B2B_UNIT: "B2B unit price",
  SOLD_TO: "Sold-to price",
  BASE_PRICE: "Base price (material)",
};

export type StepStatus = "applied" | "not-used" | "none";

/**
 * applied: this level's price is used; not-used: a valid condition exists,
 * but a level with higher priority won; none: no valid condition
 */
export function stepStatus(step: PricingStep): StepStatus {
  if (step.applied) return "applied";
  return step.amount === null ? "none" : "not-used";
}
