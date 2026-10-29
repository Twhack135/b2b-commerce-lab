import { PartnerSummary } from '../common/partner-summary';
import { ConditionTypeSummary } from '../condition-types/condition-type.interface';
import { PriceConditionScope } from '../generated/prisma/enums';

/** Short view of a B2B unit with its Sold-to */
export interface UnitSummary {
  unitId: string;
  name: string;
  isActive: boolean;
  soldTo: PartnerSummary;
}

/**
 * A price condition. Exactly one of soldTo and unit is set, depending on the
 * scope. Summaries include isActive, so clients can warn about partners or
 * units that became inactive after the condition was created.
 * amount is a decimal string; dates are YYYY-MM-DD and both inclusive.
 */
export interface PriceCondition {
  conditionId: number;
  /** Added in Sprint 9A; all other fields are unchanged */
  conditionType: ConditionTypeSummary;
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
