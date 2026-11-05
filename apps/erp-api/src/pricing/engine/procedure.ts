import {
  CurrencyPrecision,
  Decimal,
  roundToCurrency,
} from '../../common/money';
import { ConditionTypeSummary } from '../../condition-types/condition-type.interface';
import { isSupportedForPriceConditions } from '../../condition-types/condition-type-rules';
import { Prisma } from '../../generated/prisma/client';
import { PriceConditionScope } from '../../generated/prisma/enums';
import { SalesAreaKey } from '../../sales-areas/sales-area-key';
import {
  Access,
  assertInSalesArea,
  ConditionCandidate,
  evaluateAccessSequence,
} from './access-sequence';

// The calculation of a pricing procedure (Sprint 13A, docs/adr/0008),
// without database access: the same input always gives the same result,
// and every line explains itself. Steps are calculated in the order of
// their numbers:
//
// - CONDITION: the access sequence finds the record (shared evaluation, see
//   access-sequence.ts); the value is rate x quantity, rounded to the
//   decimal places of the document currency. Statistical lines are shown
//   but never part of a value. A mandatory step without a record makes the
//   item incomplete.
// - SUBTOTAL: the sum of the rounded, non-statistical condition values of
//   the steps fromStep..toStep (so a subtotal is exactly the sum of the
//   lines a reader sees).
//
// Sprint 13A calculates prices per unit (condition class PRICE, calculation
// type QUANTITY) only. Percentages, fixed amounts, exclusion groups, header
// conditions, taxes and freight follow in 13B/13C as further step kinds and
// calculation types; a configuration that needs them is refused here.

export interface ProcedureAccess extends Access {
  conditionTypeCode: string;
  /** Material-independent accesses follow in Sprint 13B */
  materialSpecific: boolean;
  conditionType: ConditionTypeSummary;
}

export interface ProcedureStepDefinition {
  stepNumber: number;
  kind: 'CONDITION' | 'SUBTOTAL';
  label: string;
  /** CONDITION: the accesses of its access sequence, in order */
  accessSequenceCode: string | null;
  accesses: ProcedureAccess[];
  fromStep: number | null;
  toStep: number | null;
  statistical: boolean;
  mandatory: boolean;
  subtotalKey: string | null;
}

export interface ProcedureDefinition {
  code: string;
  name: string;
  revision: number;
  steps: ProcedureStepDefinition[];
}

/** The subtotal that is the net value of an item */
export const NET_VALUE = 'NET_VALUE';

export interface PricingItemInput {
  itemNumber: number;
  materialNumber: string;
  quantity: number;
  /** The material's condition records of the unit, its Sold-to and the sales area */
  candidates: ConditionCandidate[];
}

export interface PricingDocumentInput {
  procedure: ProcedureDefinition;
  salesArea: SalesAreaKey;
  currency: CurrencyPrecision & { code: string };
  pricingDate: string;
  items: PricingItemInput[];
}

export type AccessResult = 'APPLIED' | 'FOUND_NOT_USED' | 'NOT_FOUND';

export interface AccessLine {
  accessNumber: number;
  conditionTypeCode: string;
  scope: PriceConditionScope;
  result: AccessResult;
  conditionId: number | null;
}

export interface ConditionLine {
  step: number;
  kind: 'CONDITION';
  label: string;
  statistical: boolean;
  mandatory: boolean;
  /** The record used, or null if no access found one */
  conditionId: number | null;
  conditionType: ConditionTypeSummary | null;
  scope: PriceConditionScope | null;
  validFrom: string | null;
  validTo: string | null;
  /** The amount per unit of the record */
  rate: Decimal | null;
  quantity: number;
  /** rate x quantity, rounded to the document currency */
  value: Decimal | null;
  accessSequenceCode: string;
  accesses: AccessLine[];
}

export interface SubtotalLine {
  step: number;
  kind: 'SUBTOTAL';
  label: string;
  key: string;
  fromStep: number;
  toStep: number;
  /** null while the item is incomplete */
  value: Decimal | null;
}

export type PricingLine = ConditionLine | SubtotalLine;

export interface PricingMessage {
  code: 'MANDATORY_CONDITION_MISSING';
  itemNumber: number;
  step: number;
  text: string;
}

export interface PricedItem {
  itemNumber: number;
  materialNumber: string;
  quantity: number;
  status: 'PRICED' | 'INCOMPLETE';
  lines: PricingLine[];
  /** The NET_VALUE subtotal; null while incomplete */
  netValue: Decimal | null;
  messages: PricingMessage[];
}

export interface PricedDocument {
  status: 'COMPLETE' | 'INCOMPLETE';
  items: PricedItem[];
  /** The sum of the items' net values; null while an item is incomplete */
  netValue: Decimal | null;
  messages: PricingMessage[];
}

/**
 * Fails if the configuration needs something this sprint cannot calculate
 * or is inconsistent. The database refuses most of it already; this keeps
 * the engine safe on its own.
 */
export function assertCalculable(procedure: ProcedureDefinition): void {
  const fail = (reason: string): never => {
    throw new Error(`Pricing procedure ${procedure.code}: ${reason}`);
  };
  const numbers = procedure.steps.map((s) => s.stepNumber);
  if (numbers.some((n, i) => i > 0 && n <= numbers[i - 1])) {
    fail('steps must be in ascending order without repetitions');
  }
  for (const step of procedure.steps) {
    if (step.kind === 'CONDITION') {
      if (step.accesses.length === 0) {
        fail(`step ${step.stepNumber} has no accesses`);
      }
      for (const access of step.accesses) {
        if (!access.materialSpecific) {
          fail(
            `step ${step.stepNumber}: material-independent accesses are not supported yet`,
          );
        }
        if (!isSupportedForPriceConditions(access.conditionType)) {
          fail(
            `step ${step.stepNumber}: ${access.conditionTypeCode} cannot be calculated yet`,
          );
        }
      }
    } else if (step.fromStep === null) {
      fail(`subtotal ${step.stepNumber} has no calculation base`);
    }
  }
  if (procedure.steps.filter((s) => s.subtotalKey === NET_VALUE).length !== 1) {
    fail(`exactly one ${NET_VALUE} subtotal is required`);
  }
}

/** Prices all items of a document with one pricing procedure */
export function calculateDocument(input: PricingDocumentInput): PricedDocument {
  assertCalculable(input.procedure);
  const items = input.items.map((item) => calculateItem(input, item));
  const complete = items.every((item) => item.status === 'PRICED');
  return {
    status: complete ? 'COMPLETE' : 'INCOMPLETE',
    items,
    netValue: complete
      ? items.reduce(
          (sum, item) => sum.add(item.netValue!),
          new Prisma.Decimal(0),
        )
      : null,
    messages: items.flatMap((item) => item.messages),
  };
}

function calculateItem(
  input: PricingDocumentInput,
  item: PricingItemInput,
): PricedItem {
  assertInSalesArea(item.candidates, input.salesArea);
  const lines: PricingLine[] = [];
  const messages: PricingMessage[] = [];

  for (const step of input.procedure.steps) {
    if (step.kind === 'SUBTOTAL') {
      const fromStep = step.fromStep!;
      const toStep = step.toStep ?? fromStep;
      const included = lines.filter(
        (line): line is ConditionLine =>
          line.kind === 'CONDITION' &&
          !line.statistical &&
          line.step >= fromStep &&
          line.step <= toStep,
      );
      lines.push({
        step: step.stepNumber,
        kind: 'SUBTOTAL',
        label: step.label,
        key: step.subtotalKey!,
        fromStep,
        toStep,
        value:
          messages.length > 0
            ? null
            : included.reduce(
                (sum, line) => sum.add(line.value ?? 0),
                new Prisma.Decimal(0),
              ),
      });
      continue;
    }

    const { winner, outcomes } = evaluateAccessSequence({
      accesses: step.accesses,
      candidates: item.candidates,
      pricingDate: input.pricingDate,
      salesArea: input.salesArea,
      currency: input.currency,
    });
    lines.push({
      step: step.stepNumber,
      kind: 'CONDITION',
      label: step.label,
      statistical: step.statistical,
      mandatory: step.mandatory,
      conditionId: winner?.conditionId ?? null,
      conditionType: winner?.conditionType ?? null,
      scope: winner?.scope ?? null,
      validFrom: winner?.validFrom ?? null,
      validTo: winner?.validTo ?? null,
      rate: winner?.amount ?? null,
      quantity: item.quantity,
      value: winner
        ? roundToCurrency(winner.amount.mul(item.quantity), input.currency)
        : null,
      accessSequenceCode: step.accessSequenceCode!,
      accesses: outcomes.map(({ access, match, applied }) => ({
        accessNumber: access.accessNumber,
        conditionTypeCode: access.conditionTypeCode!,
        scope: access.scope,
        result: applied ? 'APPLIED' : match ? 'FOUND_NOT_USED' : 'NOT_FOUND',
        conditionId: match?.conditionId ?? null,
      })),
    });
    if (step.mandatory && !winner) {
      messages.push({
        code: 'MANDATORY_CONDITION_MISSING',
        itemNumber: item.itemNumber,
        step: step.stepNumber,
        text: `No valid record for the mandatory step ${step.stepNumber} "${step.label}" of material ${item.materialNumber} on ${input.pricingDate}`,
      });
    }
  }

  const net = lines.find(
    (line): line is SubtotalLine =>
      line.kind === 'SUBTOTAL' && line.key === NET_VALUE,
  );
  return {
    itemNumber: item.itemNumber,
    materialNumber: item.materialNumber,
    quantity: item.quantity,
    status: messages.length > 0 ? 'INCOMPLETE' : 'PRICED',
    lines,
    netValue: messages.length > 0 ? null : (net?.value ?? null),
    messages,
  };
}
