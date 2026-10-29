// Business rules of the order simulation, without database access, so every
// rule can be tested directly. Comparable to the checks of an SAP sales
// order simulation (VA01 "Simulate"): nothing is saved.
import { Decimal, formatAmount } from '../common/money';
import { PartnerSummary, toPartnerSummary } from '../common/partner-summary';
import { Prisma } from '../generated/prisma/client';
import { ItemPricing, toResultSteps } from '../pricing/pricing.service';
import { RequestedShippingMethod } from './dto/simulate-sales-order.dto';
import {
  ProposedOrderBlock,
  SalesOrderSimulation,
  SimulatedItem,
  SimulationCheck,
  SimulationMessage,
  SimulationPartners,
  SimulationStatus,
} from './sales-order-simulation.interface';

/** Positions are numbered like in SAP: 10, 20, 30, ... */
export const ITEM_NUMBER_STEP = 10;

export const UNIT_INCLUDE = {
  soldTo: {
    include: { customer: true, owner: { include: { customer: true } } },
  },
  billTo: { include: { customer: true } },
  payer: { include: { customer: true } },
  shipTos: {
    include: { member: { include: { customer: true } } },
    orderBy: { customerNumber: 'asc' },
  },
} satisfies Prisma.B2bUnitInclude;

export type SimulationUnit = Prisma.B2bUnitGetPayload<{
  include: typeof UNIT_INCLUDE;
}>;

const error = (code: string, text: string, field?: string) =>
  message('ERROR', code, text, field);

function message(
  severity: SimulationMessage['severity'],
  code: string,
  text: string,
  field?: string,
): SimulationMessage {
  return field === undefined
    ? { severity, code, text }
    : { severity, code, text, field };
}

/** Optional text: missing or only whitespace means "none" */
export function optionalText(value: string | null | undefined): string | null {
  return value === undefined || value === null || value.trim() === ''
    ? null
    : value;
}

/**
 * Partners always come from the B2B unit: Sold-to, Bill-to and Payer as
 * assigned, the Ship-to as requested (it must be allowed for the unit) or
 * the unit's default Ship-to. The database guarantees that all of them
 * belong to the unit's account; inactive master data is reported here.
 */
export function resolvePartners(
  unit: SimulationUnit | null,
  unitId: string,
  shipToCustomerNumber: string | null,
): { partners: SimulationPartners | null; messages: SimulationMessage[] } {
  if (!unit) {
    return {
      partners: null,
      messages: [
        error('UNIT_NOT_FOUND', `B2B unit ${unitId} does not exist.`, 'unitId'),
      ],
    };
  }

  const messages: SimulationMessage[] = [];
  if (!unit.isActive) {
    messages.push(
      error(
        'MASTER_DATA_INACTIVE',
        `B2B unit ${unit.unitId} is inactive.`,
        'unitId',
      ),
    );
  }

  const shipToAssignment = shipToCustomerNumber
    ? unit.shipTos.find((s) => s.customerNumber === shipToCustomerNumber)
    : unit.shipTos.find((s) => s.isDefault);
  if (!shipToAssignment) {
    messages.push(
      shipToCustomerNumber
        ? error(
            'SHIP_TO_NOT_ALLOWED',
            `Customer ${shipToCustomerNumber} is not an allowed Ship-to of B2B unit ${unit.unitId}.`,
            'shipToCustomerNumber',
          )
        : error(
            'NO_DEFAULT_SHIP_TO',
            `B2B unit ${unit.unitId} has no default Ship-to. Select a Ship-to.`,
            'shipToCustomerNumber',
          ),
    );
  }

  const partners: SimulationPartners = {
    unit: { unitId: unit.unitId, name: unit.name, isActive: unit.isActive },
    account: toPartnerSummary(unit.soldTo.owner.customer),
    soldTo: toPartnerSummary(unit.soldTo.customer),
    billTo: toPartnerSummary(unit.billTo.customer),
    payer: toPartnerSummary(unit.payer.customer),
    shipTo: shipToAssignment
      ? {
          ...toPartnerSummary(shipToAssignment.member.customer),
          isDefault: shipToAssignment.isDefault,
        }
      : null,
  };

  // Every partner function must be active: an order cannot be placed for,
  // invoiced to, paid by or delivered to a customer that is no longer used
  const roles: [keyof SimulationPartners, string, PartnerSummary | null][] = [
    ['account', 'Account', partners.account],
    ['soldTo', 'Sold-to', partners.soldTo],
    ['billTo', 'Bill-to', partners.billTo],
    ['payer', 'Payer', partners.payer],
    ['shipTo', 'Ship-to', partners.shipTo],
  ];
  for (const [field, label, partner] of roles) {
    if (partner && !partner.isActive) {
      messages.push(
        error(
          'MASTER_DATA_INACTIVE',
          `${label} ${partner.customerNumber} (${partner.name}) is inactive.`,
          field,
        ),
      );
    }
  }

  return { partners, messages };
}

/**
 * One result per requested position, in request order. Positions with the
 * same material stay separate and are priced on their own.
 */
export function buildItems(
  requested: { materialNumber: string; quantity: number }[],
  pricings: ItemPricing[],
): { items: SimulatedItem[]; netValues: (Decimal | null)[] } {
  const netValues: (Decimal | null)[] = [];
  const items = requested.map((position, index): SimulatedItem => {
    const itemNumber = (index + 1) * ITEM_NUMBER_STEP;
    const { material, determination } = pricings[index];
    netValues.push(determination?.netValue ?? null);
    return {
      itemNumber,
      materialNumber: position.materialNumber,
      materialDescription: material?.description ?? null,
      quantity: position.quantity,
      unitPrice: determination ? formatAmount(determination.unitPrice) : null,
      netValue: determination ? formatAmount(determination.netValue) : null,
      currency: determination?.currency ?? null,
      pricing: determination && {
        source: determination.source,
        conditionId: determination.condition?.conditionId ?? null,
        validFrom: determination.condition?.validFrom ?? null,
        validTo: determination.condition?.validTo ?? null,
        steps: toResultSteps(determination.steps),
      },
      messages: material
        ? []
        : [
            error(
              'MATERIAL_NOT_FOUND',
              `Material ${position.materialNumber} does not exist.`,
              'materialNumber',
            ),
          ],
    };
  });
  return { items, netValues };
}

/** INFO, so a deliberate split into several positions stays VALID */
export function sameMaterialMessages(
  items: SimulatedItem[],
): SimulationMessage[] {
  const byMaterial = new Map<string, number[]>();
  for (const item of items) {
    byMaterial.set(item.materialNumber, [
      ...(byMaterial.get(item.materialNumber) ?? []),
      item.itemNumber,
    ]);
  }
  return [...byMaterial]
    .filter(([, itemNumbers]) => itemNumbers.length > 1)
    .map(([materialNumber, itemNumbers]) =>
      message(
        'INFO',
        'SAME_MATERIAL_IN_SEVERAL_ITEMS',
        `Material ${materialNumber} appears in items ${joinNumbers(itemNumbers)}. Each item is kept and priced separately.`,
      ),
    );
}

/** An order has exactly one document currency */
export function currencyMessages(items: SimulatedItem[]): SimulationMessage[] {
  const currencies = [
    ...new Set(items.flatMap((item) => (item.currency ? [item.currency] : []))),
  ];
  if (currencies.length <= 1) return [];
  const detail = currencies
    .map(
      (currency) =>
        `${currency} (items ${joinNumbers(items.filter((i) => i.currency === currency).map((i) => i.itemNumber))})`,
    )
    .join(', ');
  return [
    error(
      'MIXED_CURRENCIES',
      `All items of an order must have the same currency. Found ${detail}.`,
    ),
  ];
}

export function shippingMessages(
  method: RequestedShippingMethod,
): SimulationMessage[] {
  return method === RequestedShippingMethod.EXPRESS
    ? [
        message(
          'INFO',
          'EXPRESS_REQUESTED',
          'Express shipping is requested. It is not confirmed by this simulation: delivery date and any freight charges are confirmed during order processing.',
          'requestedShippingMethod',
        ),
      ]
    : [];
}

/**
 * A non-empty customer note means the real order would receive delivery
 * block SALES_REVIEW. This is a preview only: nothing is stored, and the
 * note never prevents placing the order.
 */
export function customerNoteResult(note: string | null): {
  requiresSalesReview: boolean;
  proposedOrderBlock: ProposedOrderBlock | null;
  messages: SimulationMessage[];
} {
  if (note === null) {
    return {
      requiresSalesReview: false,
      proposedOrderBlock: null,
      messages: [],
    };
  }
  return {
    requiresSalesReview: true,
    proposedOrderBlock: {
      type: 'DELIVERY_BLOCK',
      code: 'SALES_REVIEW',
      reason: 'CUSTOMER_NOTE',
      description:
        'If this order is placed, it will receive delivery block SALES_REVIEW. Delivery processing waits until Sales has reviewed the customer note and released the block.',
    },
    messages: [
      message(
        'WARNING',
        'SALES_REVIEW_REQUIRED',
        'The order contains a customer note. If it is placed, Sales must review the note and release delivery block SALES_REVIEW before delivery. The order itself can be placed.',
        'customerNote',
      ),
    ],
  };
}

export function simulationStatus(
  headerMessages: SimulationMessage[],
  items: SimulatedItem[],
): SimulationStatus {
  const all = [...headerMessages, ...items.flatMap((item) => item.messages)];
  if (all.some((m) => m.severity === 'ERROR')) return 'INVALID';
  if (all.some((m) => m.severity === 'WARNING')) return 'VALID_WITH_WARNINGS';
  return 'VALID';
}

/** Exact sum of all item net values; none for an invalid simulation */
export function totalsOf(
  status: SimulationStatus,
  items: SimulatedItem[],
  netValues: (Decimal | null)[],
): SalesOrderSimulation['totals'] {
  if (status === 'INVALID') return null;
  const sum = netValues.reduce<Decimal>(
    (total, value) => total.plus(value!),
    new Prisma.Decimal(0),
  );
  return {
    netValue: formatAmount(sum),
    currency: items[0].currency!,
    includes: 'NET_EXCL_TAX_AND_FREIGHT',
  };
}

/** Checks that are not part of this simulation; their result is unknown */
export const NOT_PERFORMED_CHECKS: SimulationCheck[] = [
  ['AVAILABILITY', 'Stock availability is not checked; no stock is reserved.'],
  ['DELIVERY_DATE', 'No delivery date is determined or promised.'],
  ['FREIGHT', 'Freight charges are not calculated.'],
  ['TAX', 'Taxes are not calculated; all values are net.'],
  ['CREDIT', 'No credit check is performed.'],
  ['CUSTOMER_BLOCKS', 'Commercial customer blocks are not checked yet.'],
  ['MINIMUM_ORDER_VALUE', 'Minimum order values are not checked yet.'],
].map(([check, text]) => ({ check, result: 'NOT_PERFORMED', text }));

export function checksOf(
  partnerMessages: SimulationMessage[],
  items: SimulatedItem[],
  currencyErrors: SimulationMessage[],
): SimulationCheck[] {
  const passed = (ok: boolean): SimulationCheck['result'] =>
    ok ? 'PASSED' : 'FAILED';
  const pricedItems = items.filter((item) => item.pricing !== null);
  return [
    { check: 'PARTNERS', result: passed(partnerMessages.length === 0) },
    {
      check: 'MATERIALS',
      result: passed(items.every((item) => item.messages.length === 0)),
    },
    { check: 'PRICING', result: passed(pricedItems.length === items.length) },
    pricedItems.length === 0
      ? {
          check: 'CURRENCY',
          result: 'NOT_PERFORMED',
          text: 'No item could be priced.',
        }
      : { check: 'CURRENCY', result: passed(currencyErrors.length === 0) },
    ...NOT_PERFORMED_CHECKS,
  ];
}

function joinNumbers(numbers: number[]) {
  return numbers.length <= 2
    ? numbers.join(' and ')
    : `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}
