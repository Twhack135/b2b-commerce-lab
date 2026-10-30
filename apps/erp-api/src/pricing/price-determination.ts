import {
  CurrencyPrecision,
  Decimal,
  fitsCurrency,
  roundToCurrency,
} from '../common/money';
import { ConditionTypeSummary } from '../condition-types/condition-type.interface';
import { PriceConditionScope } from '../generated/prisma/enums';
import {
  formatSalesArea,
  SalesAreaKey,
  sameSalesArea,
} from '../sales-areas/sales-area-key';

// Price determination without database access, so every rule can be tested
// directly. Comparable to an SAP access sequence for prices: the levels below
// decide which price is used; the condition type of a record (e.g. ZP01,
// ZP02) is carried along as metadata and does not change the precedence. A
// future pricing procedure will combine several condition types (list
// price, discounts, freight, tax) in one calculation.
//
// Prices are determined in exactly one sales area and its currency. There is
// no currency conversion: a condition of another sales area or currency is
// never used.

export type PricingSource = PriceConditionScope;

/** Condition levels in the order they are checked; the first match wins */
export const ACCESS_SEQUENCE: readonly PriceConditionScope[] = [
  PriceConditionScope.B2B_UNIT,
  PriceConditionScope.SOLD_TO,
  PriceConditionScope.SALES_AREA,
];

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
  /** Metadata only; the condition type does not change the precedence */
  conditionType?: ConditionTypeSummary;
}

export interface DeterminationInput {
  /** YYYY-MM-DD */
  pricingDate: string;
  quantity: number;
  /** The sales area prices are determined in */
  salesArea: SalesAreaKey;
  /** Document currency of the sales area; all conditions must use it */
  currency: CurrencyPrecision & { code: string };
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
  /** Condition type of the valid condition, e.g. ZP01 for the list price */
  conditionType: ConditionTypeSummary | null;
}

/** A price was found */
export interface PricedDetermination {
  status: 'PRICED';
  source: PricingSource;
  /** The winning condition */
  condition: ConditionCandidate;
  unitPrice: Decimal;
  netValue: Decimal;
  currency: string;
  /** Condition type of the used price */
  conditionType: ConditionTypeSummary | null;
  steps: PricingStep[];
}

/** No level has a valid condition: the material has no price here */
export interface UnpricedDetermination {
  status: 'NO_PRICE_FOUND';
  currency: string;
  steps: PricingStep[];
}

export type Determination = PricedDetermination | UnpricedDetermination;

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
 * condition, else the valid list price of the sales area. Without any of
 * them, there is no price (NO_PRICE_FOUND); nothing is guessed or converted.
 *
 * Fails instead of guessing if the data is inconsistent: a candidate of
 * another sales area or currency, an amount with more decimal places than
 * the currency has, or two valid conditions on one level. The database and
 * the services prevent all of these; a failure means a programming error.
 */
export function determinePrice(input: DeterminationInput): Determination {
  const area = formatSalesArea(input.salesArea);
  for (const candidate of input.candidates) {
    if (!sameSalesArea(candidate.salesArea, input.salesArea)) {
      throw new Error(
        `Price condition ${candidate.conditionId} belongs to sales area ${formatSalesArea(candidate.salesArea)}, not ${area}`,
      );
    }
  }

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
    steps.push({
      source: scope,
      conditionId: match?.conditionId ?? null,
      amount: match?.amount ?? null,
      applied: match !== null && winner === null,
      conditionType: match?.conditionType ?? null,
    });
    winner ??= match;
  }

  if (!winner) {
    return { status: 'NO_PRICE_FOUND', currency: input.currency.code, steps };
  }
  return {
    status: 'PRICED',
    source: winner.scope,
    condition: winner,
    unitPrice: winner.amount,
    // Exact for whole quantities; rounded by the one central rule anyway
    netValue: roundToCurrency(
      winner.amount.mul(input.quantity),
      input.currency,
    ),
    currency: input.currency.code,
    conditionType: winner.conditionType ?? null,
    steps,
  };
}
