import { CurrencyPrecision, Decimal, fitsCurrency } from '../../common/money';
import { ConditionTypeSummary } from '../../condition-types/condition-type.interface';
import { PriceConditionScope } from '../../generated/prisma/enums';
import {
  formatSalesArea,
  SalesAreaKey,
  sameSalesArea,
} from '../../sales-areas/sales-area-key';

// The one access sequence evaluation of the pricing (Sprint 13A-2), without
// database access. Used by the released base price determination
// (determinePrice: one access per level, any price condition type) and by
// the pricing procedures (e.g. ZBP1: one access per condition type and
// level). Both share every rule here: validity, sales area, currency,
// decimal places and the refusal of ambiguous data.

/**
 * A stored condition that may apply: same sales area and material, and
 * the unit, its Sold-to or no key (list price of the sales area)
 */
export interface ConditionCandidate {
  conditionId: number;
  scope: PriceConditionScope;
  salesArea: SalesAreaKey;
  amount: Decimal;
  currency: string;
  /** YYYY-MM-DD, inclusive */
  validFrom: string;
  /** YYYY-MM-DD, inclusive; null means open-ended */
  validTo: string | null;
  isActive: boolean;
  /** The condition type of the record, e.g. ZP01, ZP02 or ZP03 */
  conditionType?: ConditionTypeSummary;
}

/** One access: records of a level, of one condition type or of any (null) */
export interface Access {
  accessNumber: number;
  scope: PriceConditionScope;
  conditionTypeCode: string | null;
}

export interface AccessOutcome {
  access: Access;
  /** The valid record of this access, or null if there is none */
  match: ConditionCandidate | null;
  /** True for the access whose record is used (the first match) */
  applied: boolean;
}

export interface AccessEvaluation {
  /** The record of the first access with a valid record, or null */
  winner: ConditionCandidate | null;
  /** Every access in order, also after the winner (pricing analysis) */
  outcomes: AccessOutcome[];
}

export function isValidOn(condition: ConditionCandidate, date: string) {
  // YYYY-MM-DD texts compare like dates
  return (
    condition.isActive &&
    condition.validFrom <= date &&
    (condition.validTo === null || date <= condition.validTo)
  );
}

/**
 * Fails if a candidate belongs to another sales area: prices are only ever
 * determined in one sales area (no other market, no currency conversion).
 */
export function assertInSalesArea(
  candidates: ConditionCandidate[],
  salesArea: SalesAreaKey,
): void {
  const area = formatSalesArea(salesArea);
  for (const candidate of candidates) {
    if (!sameSalesArea(candidate.salesArea, salesArea)) {
      throw new Error(
        `Price condition ${candidate.conditionId} belongs to sales area ${formatSalesArea(candidate.salesArea)}, not ${area}`,
      );
    }
  }
}

/**
 * Searches the accesses in order; the first access with a valid record
 * wins, the later ones are still evaluated for the analysis. Fails instead
 * of guessing on inconsistent data: two valid records for one access, a
 * record in another currency than the sales area, or an amount with more
 * decimal places than the currency has. The database and the services
 * prevent all of these; a failure means a programming error.
 */
export function evaluateAccessSequence(input: {
  accesses: readonly Access[];
  candidates: ConditionCandidate[];
  pricingDate: string;
  salesArea: SalesAreaKey;
  currency: CurrencyPrecision & { code: string };
}): AccessEvaluation {
  const area = formatSalesArea(input.salesArea);
  const outcomes: AccessOutcome[] = [];
  let winner: ConditionCandidate | null = null;

  for (const access of input.accesses) {
    const valid = input.candidates.filter(
      (c) =>
        c.scope === access.scope &&
        (access.conditionTypeCode === null ||
          c.conditionType?.code === access.conditionTypeCode) &&
        isValidOn(c, input.pricingDate),
    );
    if (valid.length > 1) {
      const ids = valid.map((c) => c.conditionId).join(', ');
      const what =
        access.conditionTypeCode === null
          ? access.scope
          : `${access.conditionTypeCode} ${access.scope}`;
      throw new Error(
        `Price conditions ${ids} (${what}) are all valid on ${input.pricingDate}`,
      );
    }
    const match = valid[0] ?? null;
    if (match && match.currency !== input.currency.code) {
      throw new Error(
        `Price condition ${match.conditionId} uses ${match.currency}, but sales area ${area} uses ${input.currency.code}`,
      );
    }
    if (match && !fitsCurrency(match.amount, input.currency)) {
      throw new Error(
        `Price condition ${match.conditionId} has more decimal places than ${input.currency.code} allows`,
      );
    }
    outcomes.push({
      access,
      match,
      applied: match !== null && winner === null,
    });
    winner ??= match;
  }
  return { winner, outcomes };
}
