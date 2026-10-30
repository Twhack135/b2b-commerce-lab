import type { PartnerSummary } from "./b2b-units";
import type { ConditionTypeSummary } from "./condition-types";
import { erpFetch } from "./erp-api";
import type { SalesAreaKey } from "./sales-areas";

/**
 * Level of a price condition: a B2B unit, a Sold-to, or the whole sales area
 * (the list price, ZP01)
 */
export type PriceConditionScope = "B2B_UNIT" | "SOLD_TO" | "SALES_AREA";

/** Short view of a B2B unit with its Sold-to */
export type UnitSummary = {
  unitId: string;
  name: string;
  isActive: boolean;
  soldTo: PartnerSummary;
};

/**
 * A price condition as returned by the ERP API (see apps/erp-api
 * price-conditions) in one sales area. Depending on the scope, soldTo
 * (SOLD_TO) or unit (B2B_UNIT) is set; both are null for the list price of
 * the sales area (SALES_AREA). amount is a decimal string with the decimal
 * places of the currency (JPY: none); dates are YYYY-MM-DD and inclusive;
 * validTo null means open-ended.
 */
export type PriceCondition = {
  conditionId: number;
  /** e.g. ZP02 Customer Net Price; fixed after creation */
  conditionType: ConditionTypeSummary;
  /** Fixed after creation */
  salesArea: SalesAreaKey;
  materialNumber: string;
  materialDescription: string;
  scope: PriceConditionScope;
  soldTo: PartnerSummary | null;
  unit: UnitSummary | null;
  amount: string;
  currency: string;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
};

export type CreatePriceConditionInput = SalesAreaKey & {
  /** Required; only types usable for price conditions are accepted */
  conditionTypeCode: string;
  materialNumber: string;
  scope: PriceConditionScope;
  soldToCustomerNumber?: string;
  unitId?: string;
  amount: string;
  // No currency: the ERP API always takes the currency of the sales area
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
};

/**
 * Condition type, sales area, material, scope, Sold-to or unit and currency
 * cannot be changed
 */
export type UpdatePriceConditionInput = {
  amount: string;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
};

export function listPriceConditions() {
  return erpFetch<PriceCondition[]>("/price-conditions");
}

export function createPriceCondition(input: CreatePriceConditionInput) {
  return erpFetch<PriceCondition>("/price-conditions", {
    method: "POST",
    body: input,
  });
}

export function updatePriceCondition(
  conditionId: number,
  input: UpdatePriceConditionInput,
) {
  return erpFetch<PriceCondition>(`/price-conditions/${conditionId}`, {
    method: "PATCH",
    body: input,
  });
}
