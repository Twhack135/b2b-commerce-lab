import type { ConditionTypeSummary } from "./condition-types";
import { erpFetch } from "./erp-api";
import type { PriceConditionScope } from "./price-conditions";
import type { SalesAreaKey } from "./sales-areas";

/** The level whose price is used; SALES_AREA is the list price (ZP01) */
export type PricingSource = PriceConditionScope;

export type PriceRequest = SalesAreaKey & {
  materialNumber: string;
  unitId: string;
  pricingDate: string;
  quantity: number;
};

/** One checked level of the price determination */
export type PricingStep = {
  source: PricingSource;
  /** The valid condition of this level, or null if there is none */
  conditionId: number | null;
  amount: string | null;
  applied: boolean;
  /** e.g. ZP02, or ZP01 for the list price of the sales area */
  conditionType: ConditionTypeSummary | null;
};

/** Result of POST /pricing/price; amounts are decimal strings */
export type PriceResult = {
  materialNumber: string;
  materialDescription: string;
  /** The sales area the price was determined in */
  salesArea: SalesAreaKey;
  unitId: string;
  soldToCustomerNumber: string;
  pricingDate: string;
  quantity: number;
  /** Decimal strings with the decimal places of the currency */
  unitPrice: string;
  netValue: string;
  /** Document currency of the sales area, decided by the ERP API */
  currency: string;
  source: PricingSource;
  /** Condition type of the used price, e.g. ZP01 for the list price */
  conditionType: ConditionTypeSummary | null;
  /** Every price comes from a condition record */
  conditionId: number;
  validFrom: string;
  validTo: string | null;
  steps: PricingStep[];
};

/**
 * Body of the ERP API answer 422 NO_PRICE_FOUND: no level has a valid
 * condition. A business result, not a technical error.
 */
export type NoPriceFound = {
  code: "NO_PRICE_FOUND";
  message: string[];
  /** Every checked level, all without a valid condition */
  steps: PricingStep[];
};

/** Determines a price; nothing is stored */
export function calculatePrice(request: PriceRequest) {
  return erpFetch<PriceResult>("/pricing/price", {
    method: "POST",
    body: request,
  });
}
