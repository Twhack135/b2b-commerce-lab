import { PartnerSummary } from '../common/partner-summary';
import { ConditionTypeSummary } from '../condition-types/condition-type.interface';
import { PriceConditionScope } from '../generated/prisma/enums';
import { SalesAreaKey } from '../sales-areas/sales-area-key';

/** Short view of a B2B unit with its Sold-to */
export interface UnitSummary {
  unitId: string;
  name: string;
  isActive: boolean;
  soldTo: PartnerSummary;
}

/**
 * A price condition in one sales area. Depending on the scope, soldTo
 * (SOLD_TO) or unit (B2B_UNIT) is set; both are null for the list price of
 * the sales area (SALES_AREA). Summaries include isActive, so clients can warn about partners or
 * units that became inactive after the condition was created.
 * amount is a decimal string with the decimal places of the currency
 * (JPY: none); dates are YYYY-MM-DD and both inclusive.
 */
export interface PriceCondition {
  conditionId: number;
  /** Added in Sprint 9A; all other fields are unchanged */
  conditionType: ConditionTypeSummary;
  /** Added in Sprint 9C-B */
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
}
