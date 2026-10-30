import { ConditionTypeSummary } from '../condition-types/condition-type.interface';
import { SalesAreaKey } from '../sales-areas/sales-area-key';
import { PricingSource } from './price-determination';

export interface PriceResultStep {
  source: PricingSource;
  conditionId: number | null;
  amount: string | null;
  applied: boolean;
  /** e.g. ZP01 for the list price of the sales area, ZP02 or ZP03 */
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
  /** Added in Sprint 9C-B: the sales area the price was determined in */
  salesArea: SalesAreaKey;
  unitId: string;
  soldToCustomerNumber: string;
  pricingDate: string;
  quantity: number;
  /** Decimal strings with the decimal places of the currency (JPY: none) */
  unitPrice: string;
  netValue: string;
  /** Document currency of the sales area */
  currency: string;
  source: PricingSource;
  /** Condition type of the used price, e.g. ZP01 for the list price */
  conditionType: ConditionTypeSummary | null;
  /** The winning condition and its validity; since 9C-B every price is a condition record */
  conditionId: number;
  validFrom: string;
  validTo: string | null;
  steps: PriceResultStep[];
}
