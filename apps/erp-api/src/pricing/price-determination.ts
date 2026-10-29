import { Decimal, roundAmount } from '../common/money';
import { PriceConditionScope } from '../generated/prisma/enums';

// Price determination without database access, so every rule can be tested
// directly. Comparable to an SAP access sequence with a single condition type.

export type PricingSource = PriceConditionScope | 'BASE_PRICE';

/** Condition levels in the order they are checked; the first match wins */
export const ACCESS_SEQUENCE: readonly PriceConditionScope[] = [
  PriceConditionScope.B2B_UNIT,
  PriceConditionScope.SOLD_TO,
];

/** A stored condition that may apply (same material and Sold-to or unit) */
export interface ConditionCandidate {
  conditionId: number;
  scope: PriceConditionScope;
  amount: Decimal;
  currency: string;
  /** YYYY-MM-DD, inclusive */
  validFrom: string;
  /** YYYY-MM-DD, inclusive; null means open-ended */
  validTo: string | null;
  isActive: boolean;
}

export interface DeterminationInput {
  /** YYYY-MM-DD */
  pricingDate: string;
  quantity: number;
  /** Material.price, the fallback */
  basePrice: Decimal;
  /** Material.currency; all conditions must use it */
  currency: string;
  candidates: ConditionCandidate[];
}

/** One checked level, as in the SAP pricing analysis */
export interface PricingStep {
  source: PricingSource;
  /** The valid condition of this level, or null if there is none */
  conditionId: number | null;
  amount: Decimal | null;
  /** True for the level whose price is used */
  applied: boolean;
}

export interface Determination {
  source: PricingSource;
  /** The winning condition (null for the base price) */
  condition: ConditionCandidate | null;
  unitPrice: Decimal;
  netValue: Decimal;
  currency: string;
  steps: PricingStep[];
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
 * Determines the price: the valid B2B unit condition, else the valid Sold-to
 * condition, else the base price. Fails instead of guessing if the stored
 * data is inconsistent (two valid conditions on one level, which the
 * database prevents, or a condition in another currency).
 */
export function determinePrice(input: DeterminationInput): Determination {
  const steps: PricingStep[] = [];
  let winner: ConditionCandidate | null = null;

  for (const scope of ACCESS_SEQUENCE) {
    const valid = input.candidates.filter(
      (c) => c.scope === scope && isValidOn(c, input.pricingDate),
    );
    if (valid.length > 1) {
      const ids = valid.map((c) => c.conditionId).join(', ');
      throw new Error(
        `Price conditions ${ids} (${scope}) are all valid on ${input.pricingDate}`,
      );
    }
    const match = valid[0] ?? null;
    if (match && match.currency !== input.currency) {
      throw new Error(
        `Price condition ${match.conditionId} uses ${match.currency}, but the material uses ${input.currency}`,
      );
    }
    steps.push({
      source: scope,
      conditionId: match?.conditionId ?? null,
      amount: match?.amount ?? null,
      applied: match !== null && winner === null,
    });
    winner ??= match;
  }

  steps.push({
    source: 'BASE_PRICE',
    conditionId: null,
    amount: input.basePrice,
    applied: winner === null,
  });

  const unitPrice = winner?.amount ?? input.basePrice;
  return {
    source: winner?.scope ?? 'BASE_PRICE',
    condition: winner,
    unitPrice,
    // Exact for whole quantities; rounded by the one central rule anyway
    netValue: roundAmount(unitPrice.mul(input.quantity)),
    currency: input.currency,
    steps,
  };
}
