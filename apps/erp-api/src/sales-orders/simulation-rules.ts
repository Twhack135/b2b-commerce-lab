// Business rules of the order simulation, without database access, so every
// rule can be tested directly. Comparable to the checks of an SAP sales
// order simulation (VA01 "Simulate"): nothing is saved.
import { CurrencyPrecision, Decimal, formatInCurrency } from '../common/money';
import { PartnerSummary, toPartnerSummary } from '../common/partner-summary';
import { Prisma } from '../generated/prisma/client';
import {
  ItemPricing,
  noPriceText,
  toResultSteps,
} from '../pricing/pricing.service';
import {
  formatSalesArea,
  SalesAreaKey,
  SalesAreaWithCurrency,
  sameSalesArea,
} from '../sales-areas/sales-area-key';
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
 * The sales area must exist and be active, and the unit must belong to it.
 * Otherwise nothing is priced: a unit is never priced with the conditions
 * of another market.
 */
export function salesAreaMessages(
  key: SalesAreaKey,
  salesArea: SalesAreaWithCurrency | null,
  unit: (SalesAreaKey & { unitId: string }) | null,
): SimulationMessage[] {
  const area = formatSalesArea(key);
  if (!salesArea) {
    return [
      error(
        'SALES_AREA_NOT_FOUND',
        `Sales area ${area} does not exist.`,
        'salesOrganization',
      ),
    ];
  }
  const messages: SimulationMessage[] = [];
  if (!salesArea.isActive) {
    messages.push(
      error(
        'SALES_AREA_INACTIVE',
        `Sales area ${area} is inactive.`,
        'salesOrganization',
      ),
    );
  }
  if (unit && !sameSalesArea(unit, key)) {
    messages.push(
      error(
        'UNIT_NOT_IN_SALES_AREA',
        `B2B unit ${unit.unitId} belongs to sales area ${formatSalesArea(unit)}, not ${area}.`,
        'unitId',
      ),
    );
  }
  return messages;
}

/**
 * One result per requested position, in request order. Positions with the
 * same material stay separate and are priced on their own. Amounts have the
 * decimal places of the document currency (JPY: none).
 */
export function buildItems(
  requested: { materialNumber: string; quantity: number }[],
  pricings: ItemPricing[],
  context: {
    salesArea: SalesAreaKey;
    pricingDate: string;
    currency: CurrencyPrecision | null;
  },
): { items: SimulatedItem[]; netValues: (Decimal | null)[] } {
  const netValues: (Decimal | null)[] = [];
  const items = requested.map((position, index): SimulatedItem => {
    const itemNumber = (index + 1) * ITEM_NUMBER_STEP;
    const { material, determination } = pricings[index];
    const priced =
      determination?.status === 'PRICED' && context.currency
        ? determination
        : null;
    const format = (value: Decimal) =>
      formatInCurrency(value, context.currency!);
    netValues.push(priced?.netValue ?? null);

    const messages: SimulationMessage[] = [];
    if (!material) {
      messages.push(
        error(
          'MATERIAL_NOT_FOUND',
          `Material ${position.materialNumber} does not exist.`,
          'materialNumber',
        ),
      );
    } else if (determination?.status === 'NO_PRICE_FOUND') {
      messages.push(
        error(
          'NO_PRICE_FOUND',
          `${noPriceText(position.materialNumber, context.salesArea, context.pricingDate)}.`,
          'materialNumber',
        ),
      );
    }

    return {
      itemNumber,
      materialNumber: position.materialNumber,
      materialDescription: material?.description ?? null,
      quantity: position.quantity,
      unitPrice: priced ? format(priced.unitPrice) : null,
      netValue: priced ? format(priced.netValue) : null,
      currency: priced?.currency ?? null,
      pricing: priced && {
        source: priced.source,
        conditionType: priced.conditionType,
        conditionId: priced.condition.conditionId,
        validFrom: priced.condition.validFrom,
        validTo: priced.condition.validTo,
        steps: toResultSteps(priced.steps, context.currency!),
      },
      messages,
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

/**
 * An order has exactly one document currency, the currency of its sales
 * area. All prices are determined in it, so this can only fail through a
 * programming error; it stays as a safety net.
 */
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
 * The requested delivery date is a wish of the customer: it must not be
 * before the order date, and it is never confirmed by a simulation (no
 * availability check, no scheduling). It does not affect prices.
 */
export function requestedDeliveryDateMessages(
  requestedDeliveryDate: string | null,
  orderDate: string,
): SimulationMessage[] {
  if (requestedDeliveryDate === null) return [];
  // YYYY-MM-DD texts compare like dates
  if (requestedDeliveryDate < orderDate) {
    return [
      error(
        'REQUESTED_DELIVERY_DATE_BEFORE_ORDER_DATE',
        `The requested delivery date ${requestedDeliveryDate} is before the order date ${orderDate}.`,
        'requestedDeliveryDate',
      ),
    ];
  }
  return [
    message(
      'INFO',
      'REQUESTED_DELIVERY_DATE_NOT_CONFIRMED',
      `Delivery on ${requestedDeliveryDate} is requested. It is not confirmed by this simulation: the delivery date is confirmed during order processing.`,
      'requestedDeliveryDate',
    ),
  ];
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

/**
 * Exact sum of all item net values in the document currency; none for an
 * invalid simulation
 */
export function totalsOf(
  status: SimulationStatus,
  netValues: (Decimal | null)[],
  currency: (CurrencyPrecision & { code: string }) | null,
): SalesOrderSimulation['totals'] {
  if (status === 'INVALID' || !currency) return null;
  const sum = netValues.reduce<Decimal>(
    (total, value) => total.plus(value!),
    new Prisma.Decimal(0),
  );
  return {
    netValue: formatInCurrency(sum, currency),
    currency: currency.code,
    includes: 'NET_EXCL_TAX_AND_FREIGHT',
  };
}

/** Checks that are not part of this simulation; their result is unknown */
export const NOT_PERFORMED_CHECKS: SimulationCheck[] = [
  ['AVAILABILITY', 'Stock availability is not checked; no stock is reserved.'],
  [
    'DELIVERY_DATE',
    'No delivery date is determined or promised; a requested delivery date is not checked.',
  ],
  ['FREIGHT', 'Freight charges are not calculated.'],
  ['TAX', 'Taxes are not calculated; all values are net.'],
  ['CREDIT', 'No credit check is performed.'],
  ['CUSTOMER_BLOCKS', 'Commercial customer blocks are not checked yet.'],
  ['MINIMUM_ORDER_VALUE', 'Minimum order values are not checked yet.'],
].map(([check, text]) => ({ check, result: 'NOT_PERFORMED', text }));

export function checksOf(
  salesAreaErrors: SimulationMessage[],
  partnerMessages: SimulationMessage[],
  items: SimulatedItem[],
  currencyErrors: SimulationMessage[],
): SimulationCheck[] {
  const passed = (ok: boolean): SimulationCheck['result'] =>
    ok ? 'PASSED' : 'FAILED';
  const pricedItems = items.filter((item) => item.pricing !== null);
  return [
    { check: 'SALES_AREA', result: passed(salesAreaErrors.length === 0) },
    { check: 'PARTNERS', result: passed(partnerMessages.length === 0) },
    {
      check: 'MATERIALS',
      result: passed(
        items.every((item) =>
          item.messages.every((m) => m.code !== 'MATERIAL_NOT_FOUND'),
        ),
      ),
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
