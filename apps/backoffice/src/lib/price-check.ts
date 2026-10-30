// Form and display logic of the Price Check panel.
// Only type imports and import-free helpers, so it can be tested directly
// with `node --test`.
import { isCalendarDate } from "./dates.ts";
import type {
  NoPriceFound,
  PriceRequest,
  PricingSource,
  PricingStep,
} from "./pricing.ts";
import { parseSalesAreaId, salesAreaId } from "./sales-area-display.ts";
import type { SalesAreaKey } from "./sales-areas.ts";

export const MAX_QUANTITY = 99_999;

export type PriceCheckValues = {
  /** Sales area as "1000/10/00"; the unit must belong to it */
  salesArea: string;
  materialNumber: string;
  unitId: string;
  pricingDate: string;
  /** Text input; a whole number of pieces */
  quantity: string;
};

export type PriceCheckField = keyof PriceCheckValues;

export type PriceCheckErrors = Partial<Record<PriceCheckField, string>>;

export const PRICE_CHECK_FIELDS: PriceCheckField[] = [
  "salesArea",
  "materialNumber",
  "unitId",
  "pricingDate",
  "quantity",
];

/**
 * Units of the sales area only; a unit of another market is reported
 * instead of being sent (the ERP API would reject it, too)
 */
export function validatePriceCheck(
  values: PriceCheckValues,
  units: { unitId: string; salesArea: SalesAreaKey }[] = [],
): PriceCheckErrors {
  const errors: PriceCheckErrors = {};
  const key = parseSalesAreaId(values.salesArea);
  if (!key) errors.salesArea = "Select a sales area.";
  if (values.materialNumber === "") errors.materialNumber = "Select a material.";
  const unit = units.find((u) => u.unitId === values.unitId);
  if (values.unitId === "") {
    errors.unitId = "Select a B2B unit.";
  } else if (key && unit) {
    const unitArea = salesAreaId(unit.salesArea);
    if (unitArea !== values.salesArea) {
      errors.unitId = `B2B unit ${unit.unitId} belongs to sales area ${unitArea}, not ${values.salesArea}.`;
    }
  }
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
  const key = parseSalesAreaId(values.salesArea);
  if (!key) throw new Error(`Not a sales area: ${values.salesArea}`);
  return {
    ...key,
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
  SALES_AREA: "List price (sales area)",
};

/**
 * The body of a 422 NO_PRICE_FOUND answer, or null for any other error.
 * No price is a business result: it is shown with its pricing analysis.
 */
export function noPriceFoundOf(data: unknown): NoPriceFound | null {
  if (data === null || typeof data !== "object") return null;
  const body = data as Partial<NoPriceFound>;
  if (body.code !== "NO_PRICE_FOUND") return null;
  return {
    code: "NO_PRICE_FOUND",
    message: Array.isArray(body.message) ? body.message : [],
    steps: Array.isArray(body.steps) ? body.steps : [],
  };
}

export type StepStatus = "applied" | "not-used" | "none";

/**
 * applied: this level's price is used; not-used: a valid condition exists,
 * but a level with higher priority won; none: no valid condition
 */
export function stepStatus(step: PricingStep): StepStatus {
  if (step.applied) return "applied";
  return step.amount === null ? "none" : "not-used";
}
