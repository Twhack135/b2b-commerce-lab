import {
  CalculationType,
  ConditionClass,
  PriceConditionScope,
} from '../generated/prisma/enums';
import {
  ConditionRecordRestriction,
  ConditionTypeSummary,
} from './condition-type.interface';

/**
 * What the pricing engine can calculate today: prices per unit. Discounts,
 * freight and tax (other classes and calculation types) follow with a
 * pricing procedure; their condition types exist as configuration only.
 * This is a capability of the code, not configuration, so it lives here.
 */
export function isSupportedForPriceConditions(type: {
  conditionClass: ConditionClass;
  calculationType: CalculationType;
}) {
  return (
    type.conditionClass === ConditionClass.PRICE &&
    type.calculationType === CalculationType.QUANTITY
  );
}

type ConditionTypeRow = {
  name: string;
  conditionClass: ConditionClass;
  calculationType: CalculationType;
  isActive: boolean;
  allowedForConditionRecords: boolean;
};

/**
 * Why new condition records cannot use this type, or null if they can.
 * Checked in this order: active (configuration), calculable by the engine
 * (code), allowed for condition records (configuration).
 */
export function conditionRecordRestriction(
  type: ConditionTypeRow,
): ConditionRecordRestriction | null {
  if (!type.isActive) return 'INACTIVE';
  if (!isSupportedForPriceConditions(type)) return 'CALCULATION_NOT_SUPPORTED';
  if (!type.allowedForConditionRecords)
    return 'NOT_ALLOWED_FOR_CONDITION_RECORDS';
  return null;
}

export function toConditionTypeSummary(type: {
  code: string;
  name: string;
  conditionClass: ConditionClass;
  calculationType: CalculationType;
}): ConditionTypeSummary {
  return {
    code: type.code,
    name: type.name,
    conditionClass: type.conditionClass,
    calculationType: type.calculationType,
  };
}

/**
 * Why a condition type cannot be used for a new or reactivated price
 * condition record, or no message if it can. Messages start with the
 * request field, like all validation messages of the ERP API.
 */
export function conditionTypeViolations(
  code: string,
  type: ConditionTypeRow | null | undefined,
): string[] {
  if (!type) return [`conditionTypeCode ${code} does not exist`];
  switch (conditionRecordRestriction(type)) {
    case 'INACTIVE':
      return [`conditionTypeCode ${code} (${type.name}) is inactive`];
    case 'CALCULATION_NOT_SUPPORTED':
      return [
        `conditionTypeCode ${code} (${type.name}) cannot be used for price conditions yet: only condition types of class PRICE with calculation type QUANTITY are supported, not ${type.conditionClass} with ${type.calculationType}`,
      ];
    case 'NOT_ALLOWED_FOR_CONDITION_RECORDS':
      return [
        `conditionTypeCode ${code} (${type.name}) is not allowed for condition records by its configuration`,
      ];
    default:
      return [];
  }
}

/**
 * Why a condition type cannot be used with a scope, or no message if it
 * can. The allowed scopes are configuration (condition_type_scopes), e.g.
 * ZP01 only per sales area; the database enforces the same rule.
 */
export function scopeViolations(
  code: string,
  type: { name: string; allowedScopes: { scope: PriceConditionScope }[] },
  scope: PriceConditionScope,
): string[] {
  const allowed = type.allowedScopes.map((s) => s.scope);
  if (allowed.includes(scope)) return [];
  return [
    allowed.length === 0
      ? `conditionTypeCode ${code} (${type.name}) cannot be used with scope ${scope}: no scope is configured for it`
      : `conditionTypeCode ${code} (${type.name}) cannot be used with scope ${scope}; allowed scopes: ${allowed.join(', ')}`,
  ];
}
