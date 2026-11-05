import { CurrencyPrecision, Decimal, roundToCurrency } from '../common/money';
import { ConditionTypeSummary } from '../condition-types/condition-type.interface';
import { PriceConditionScope } from '../generated/prisma/enums';
import { SalesAreaKey } from '../sales-areas/sales-area-key';
import {
  Access,
  assertInSalesArea,
  ConditionCandidate,
  evaluateAccessSequence,
} from './engine/access-sequence';

export { isValidOn } from './engine/access-sequence';
export type { ConditionCandidate } from './engine/access-sequence';

// The released base price determination (POST /pricing/price, the order
// simulation and order creation), without database access. Comparable to an
// SAP access sequence for prices: the levels below decide which price is
// used; the condition type of a record (e.g. ZP01, ZP02) is carried along as
// metadata and does not change the precedence.
//
// Since Sprint 13A it runs on the shared access sequence evaluation
// (engine/access-sequence.ts) with one access per level for any price
// condition type, which is exactly the released behavior (regression
// fixtures: price-determination.regression.spec.ts). The pricing procedures
// use the same evaluation with their own access sequences (e.g. ZBP1).
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

/** The levels as accesses for any price condition type */
const LEVEL_ACCESSES: readonly Access[] = ACCESS_SEQUENCE.map(
  (scope, index) => ({
    accessNumber: (index + 1) * 10,
    scope,
    conditionTypeCode: null,
  }),
);

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
  assertInSalesArea(input.candidates, input.salesArea);
  const { winner, outcomes } = evaluateAccessSequence({
    accesses: LEVEL_ACCESSES,
    candidates: input.candidates,
    pricingDate: input.pricingDate,
    salesArea: input.salesArea,
    currency: input.currency,
  });
  const steps: PricingStep[] = outcomes.map(({ access, match, applied }) => ({
    source: access.scope,
    conditionId: match?.conditionId ?? null,
    amount: match?.amount ?? null,
    applied,
    conditionType: match?.conditionType ?? null,
  }));

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
