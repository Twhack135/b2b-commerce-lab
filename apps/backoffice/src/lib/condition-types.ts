import { erpFetch } from "./erp-api";
import type { PriceConditionScope } from "./price-conditions";

// Condition types as returned by the ERP API (see apps/erp-api
// condition-types). Read-only configuration, e.g. ZP02 Customer Net Price.

export type ConditionClass = "PRICE" | "DISCOUNT_SURCHARGE" | "FREIGHT" | "TAX";

export type CalculationType = "QUANTITY" | "FIXED_AMOUNT" | "PERCENTAGE";

/** Short view of a condition type, part of condition records and pricing results */
export type ConditionTypeSummary = {
  code: string;
  name: string;
  conditionClass: ConditionClass;
  calculationType: CalculationType;
};

/** Why new condition records cannot use a type; decided by the ERP API */
export type ConditionRecordRestriction =
  | "INACTIVE"
  | "CALCULATION_NOT_SUPPORTED"
  | "NOT_ALLOWED_FOR_CONDITION_RECORDS";

export type ConditionType = ConditionTypeSummary & {
  isActive: boolean;
  sortOrder: number;
  allowedForConditionRecords: boolean;
  /** True if new price condition records may use this type */
  usableForPriceConditions: boolean;
  restriction: ConditionRecordRestriction | null;
  /**
   * The scopes records of this type may use (configuration of the ERP API),
   * e.g. ["SALES_AREA"] for ZP01 and ["B2B_UNIT", "SOLD_TO"] for ZP02
   */
  allowedScopes: PriceConditionScope[];
};

export function listConditionTypes() {
  return erpFetch<ConditionType[]>("/condition-types");
}
