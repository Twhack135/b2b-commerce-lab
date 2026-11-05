import type { ConditionTypeSummary } from "./condition-types";
import { erpFetch } from "./erp-api";
import type { PriceConditionScope } from "./price-conditions";
import type { SalesAreaKey } from "./sales-areas";

// Pricing procedures as returned by the ERP API (Sprint 13A, see apps/erp-api
// pricing-procedures). Read-only configuration, versioned through migrations.

export type AccessSequenceAccess = {
  accessNumber: number;
  conditionType: ConditionTypeSummary;
  scope: PriceConditionScope;
  materialSpecific: boolean;
};

export type AccessSequence = { code: string; name: string; accesses: AccessSequenceAccess[] };

export type PricingProcedureStep = {
  stepNumber: number;
  kind: "CONDITION" | "SUBTOTAL";
  label: string;
  accessSequence: AccessSequence | null;
  fromStep: number | null;
  toStep: number | null;
  statistical: boolean;
  mandatory: boolean;
  subtotalKey: string | null;
  customerVisible: boolean;
};

export type PricingProcedureSummary = {
  code: string;
  name: string;
  revision: number;
  isActive: boolean;
  /** "*" as customerProcedure: for every customer */
  assignments: (SalesAreaKey & { customerProcedure: string })[];
  stepCount: number;
};

export type PricingProcedure = PricingProcedureSummary & { steps: PricingProcedureStep[] };

export function listPricingProcedures() {
  return erpFetch<PricingProcedureSummary[]>("/pricing-procedures");
}

export function getPricingProcedure(code: string) {
  return erpFetch<PricingProcedure>(`/pricing-procedures/${encodeURIComponent(code)}`);
}
