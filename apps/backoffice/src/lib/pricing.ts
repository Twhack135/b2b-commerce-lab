import { erpFetch } from "./erp-api";
import type { PriceConditionScope } from "./price-conditions";

export type PricingSource = PriceConditionScope | "BASE_PRICE";

export type PriceRequest = {
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
};

/** Result of POST /pricing/price; amounts are decimal strings */
export type PriceResult = {
  materialNumber: string;
  materialDescription: string;
  unitId: string;
  soldToCustomerNumber: string;
  pricingDate: string;
  quantity: number;
  unitPrice: string;
  netValue: string;
  currency: string;
  source: PricingSource;
  conditionId: number | null;
  validFrom: string | null;
  validTo: string | null;
  steps: PricingStep[];
};

/** Determines a price; nothing is stored */
export function calculatePrice(request: PriceRequest) {
  return erpFetch<PriceResult>("/pricing/price", {
    method: "POST",
    body: request,
  });
}
