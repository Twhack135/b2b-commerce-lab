import { ConditionTypeSummary } from '../condition-types/condition-type.interface';
import { PricingSource } from './price-determination';

export interface PriceResultStep {
  source: PricingSource;
  conditionId: number | null;
  amount: string | null;
  applied: boolean;
  /** Added in Sprint 9A: e.g. ZP02, or ZP01 for the base price */
  conditionType: ConditionTypeSummary | null;
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
  /** Added in Sprint 9A: condition type of the used price (ZP01 for the base price) */
  conditionType: ConditionTypeSummary | null;
  /** The winning condition and its validity; null for the base price */
  conditionId: number | null;
  validFrom: string | null;
  validTo: string | null;
  steps: PriceResultStep[];
}
