import { PricingSource } from './price-determination';

export interface PriceResultStep {
  source: PricingSource;
  conditionId: number | null;
  amount: string | null;
  applied: boolean;
}

/**
 * Result of a price determination. Amounts are decimal strings.
 * It contains everything a future order item needs to store the price that
 * was actually determined (source, condition, amounts, currency and date),
 * so orders never have to recalculate prices later.
 */
export interface PriceResult {
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
  /** The winning condition and its validity; null for the base price */
  conditionId: number | null;
  validFrom: string | null;
  validTo: string | null;
  steps: PriceResultStep[];
}
