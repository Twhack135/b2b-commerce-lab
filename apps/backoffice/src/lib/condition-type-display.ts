// Display texts for condition types. The rules (which type can be used) are
// decided by the ERP API; this file only turns its answers into text.
// Only type imports, so it can be tested directly with `node --test`.
import type {
  CalculationType,
  ConditionClass,
  ConditionRecordRestriction,
  ConditionTypeSummary,
} from "./condition-types.ts";

export const CONDITION_CLASS_LABELS: Record<ConditionClass, string> = {
  PRICE: "Price",
  DISCOUNT_SURCHARGE: "Discount / surcharge",
  FREIGHT: "Freight",
  TAX: "Tax",
};

export const CALCULATION_TYPE_LABELS: Record<CalculationType, string> = {
  QUANTITY: "Per unit",
  FIXED_AMOUNT: "Fixed amount",
  PERCENTAGE: "Percentage",
};

/** Why a type cannot be used for new condition records */
export const RESTRICTION_TEXTS: Record<ConditionRecordRestriction, string> = {
  INACTIVE: "Inactive",
  CALCULATION_NOT_SUPPORTED: "Not supported yet – calculated in a later release",
  NOT_ALLOWED_FOR_CONDITION_RECORDS: "Not allowed for condition records",
};

/** e.g. "ZP02 – Customer Net Price" */
export function conditionTypeLabel(type: Pick<ConditionTypeSummary, "code" | "name">) {
  return `${type.code} – ${type.name}`;
}
