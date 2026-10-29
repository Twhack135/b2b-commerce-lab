import type { PartnerSummary } from "./b2b-units";
import { erpFetch } from "./erp-api";

export type PriceConditionScope = "B2B_UNIT" | "SOLD_TO";

/** Short view of a B2B unit with its Sold-to */
export type UnitSummary = {
  unitId: string;
  name: string;
  isActive: boolean;
  soldTo: PartnerSummary;
};

/**
 * A price condition as returned by the ERP API (see apps/erp-api
 * price-conditions). Exactly one of soldTo and unit is set. amount is a
 * decimal string; dates are YYYY-MM-DD and inclusive; validTo null means
 * open-ended.
 */
export type PriceCondition = {
  conditionId: number;
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

export type CreatePriceConditionInput = {
  materialNumber: string;
  scope: PriceConditionScope;
  soldToCustomerNumber?: string;
  unitId?: string;
  amount: string;
  currency: string;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
};

/** Material, scope, Sold-to or unit and currency cannot be changed */
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
