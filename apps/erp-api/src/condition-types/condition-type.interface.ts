import { CalculationType, ConditionClass } from '../generated/prisma/enums';

/**
 * Short view of a condition type, added to condition records and to the
 * pricing analysis, e.g. { code: 'ZP02', name: 'Customer Net Price', ... }
 */
export interface ConditionTypeSummary {
  code: string;
  name: string;
  conditionClass: ConditionClass;
  calculationType: CalculationType;
}

/**
 * Why new condition records cannot use a type:
 * - INACTIVE: the type is deactivated (configuration)
 * - CALCULATION_NOT_SUPPORTED: the pricing engine cannot calculate its class
 *   and calculation type yet (code)
 * - NOT_ALLOWED_FOR_CONDITION_RECORDS: not allowed by its configuration,
 *   e.g. ZP01, which comes from the material master for now
 */
export type ConditionRecordRestriction =
  | 'INACTIVE'
  | 'CALCULATION_NOT_SUPPORTED'
  | 'NOT_ALLOWED_FOR_CONDITION_RECORDS';

/** A condition type as returned by GET /condition-types */
export interface ConditionType extends ConditionTypeSummary {
  isActive: boolean;
  sortOrder: number;
  /** Configuration: may condition records use this type? */
  allowedForConditionRecords: boolean;
  /**
   * True if new price condition records may use this type: active,
   * calculable by the pricing engine and allowed by its configuration.
   * Clients use this instead of knowing the rules themselves.
   */
  usableForPriceConditions: boolean;
  /** Why it is not usable; null if it is */
  restriction: ConditionRecordRestriction | null;
}
