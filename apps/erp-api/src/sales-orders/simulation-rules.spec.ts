import { Prisma } from '../generated/prisma/client';
import { Determination } from '../pricing/price-determination';
import { ItemPricing } from '../pricing/pricing.service';
import { RequestedShippingMethod } from './dto/simulate-sales-order.dto';
import { SimulatedItem } from './sales-order-simulation.interface';
import {
  buildItems,
  checksOf,
  currencyMessages,
  customerNoteResult,
  optionalText,
  requestedDeliveryDateMessages,
  resolvePartners,
  sameMaterialMessages,
  shippingMessages,
  simulationStatus,
  SimulationUnit,
  totalsOf,
} from './simulation-rules';

const d = (value: string) => new Prisma.Decimal(value);

const customer = (customerNumber: string, isActive = true) => ({
  customerNumber,
  name: `Customer ${customerNumber}`,
  street: 's',
  postalCode: '1',
  city: 'c',
  country: 'DE',
  isActive,
});

const member = (customerNumber: string, isActive = true) => ({
  customerNumber,
  accountCustomerNumber: 'CUST-1000',
  accountOwnerRef: 'CUST-1000',
  customer: customer(customerNumber, isActive),
});

/** UNIT-STUTTGART as in the development data */
function unit(
  changes: {
    isActive?: boolean;
    inactive?: string[];
    noDefault?: boolean;
  } = {},
): SimulationUnit {
  const inactive = changes.inactive ?? [];
  const m = (n: string) => member(n, !inactive.includes(n));
  return {
    unitId: 'UNIT-STUTTGART',
    name: 'Müller – Stuttgart',
    accountCustomerNumber: 'CUST-1000',
    soldToCustomerNumber: 'CUST-1000',
    billToCustomerNumber: 'CUST-1000',
    payerCustomerNumber: 'CUST-1000',
    isActive: changes.isActive ?? true,
    soldTo: { ...m('CUST-1000'), owner: m('CUST-1000') },
    billTo: m('CUST-1000'),
    payer: m('CUST-1000'),
    shipTos: ['CUST-1000', 'CUST-1100', 'CUST-1200'].map((n) => ({
      unitId: 'UNIT-STUTTGART',
      customerNumber: n,
      accountCustomerNumber: 'CUST-1000',
      isDefault: n === 'CUST-1100' && !changes.noDefault,
      member: m(n),
    })),
  };
}

function determination(
  unitPrice: string,
  quantity: number,
  currency = 'EUR',
): Determination {
  return {
    source: 'BASE_PRICE',
    condition: null,
    unitPrice: d(unitPrice),
    netValue: d(unitPrice).mul(quantity),
    currency,
    conditionType: null,
    steps: [],
  };
}

const material = (materialNumber: string, currency = 'EUR') => ({
  materialNumber,
  description: `Material ${materialNumber}`,
  price: d('1'),
  currency,
});

/** Items as built from priced positions */
function items(positions: [string, number, string | null, string?][]): {
  items: SimulatedItem[];
  netValues: (Prisma.Decimal | null)[];
} {
  const pricings: ItemPricing[] = positions.map(
    ([materialNumber, quantity, price, currency]) =>
      price === null
        ? { material: null, determination: null }
        : {
            material: material(materialNumber, currency),
            determination: determination(price, quantity, currency),
          },
  );
  return buildItems(
    positions.map(([materialNumber, quantity]) => ({
      materialNumber,
      quantity,
    })),
    pricings,
  );
}

describe('optionalText', () => {
  it.each([
    [undefined, null],
    [null, null],
    ['', null],
    ['   ', null],
    ['\n\t \r\n', null],
    ['Tor 3', 'Tor 3'],
    ['  Tor 3  ', '  Tor 3  '],
  ])('turns %p into %p', (input, expected) => {
    expect(optionalText(input)).toBe(expected);
  });
});

describe('resolvePartners', () => {
  it('takes all partners from the unit and the default Ship-to', () => {
    const { partners, messages } = resolvePartners(
      unit(),
      'UNIT-STUTTGART',
      null,
    );

    expect(messages).toEqual([]);
    expect(partners).toMatchObject({
      unit: { unitId: 'UNIT-STUTTGART', isActive: true },
      account: { customerNumber: 'CUST-1000' },
      soldTo: { customerNumber: 'CUST-1000' },
      billTo: { customerNumber: 'CUST-1000' },
      payer: { customerNumber: 'CUST-1000' },
      shipTo: { customerNumber: 'CUST-1100', isDefault: true },
    });
  });

  it('accepts another allowed Ship-to', () => {
    const { partners, messages } = resolvePartners(
      unit(),
      'UNIT-STUTTGART',
      'CUST-1200',
    );
    expect(messages).toEqual([]);
    expect(partners?.shipTo).toMatchObject({
      customerNumber: 'CUST-1200',
      isDefault: false,
    });
  });

  it('rejects a Ship-to that is not allowed for the unit', () => {
    const { partners, messages } = resolvePartners(
      unit(),
      'UNIT-STUTTGART',
      'CUST-9999',
    );
    expect(partners?.shipTo).toBeNull();
    expect(messages).toEqual([
      {
        severity: 'ERROR',
        code: 'SHIP_TO_NOT_ALLOWED',
        text: 'Customer CUST-9999 is not an allowed Ship-to of B2B unit UNIT-STUTTGART.',
        field: 'shipToCustomerNumber',
      },
    ]);
  });

  it('reports a missing default Ship-to', () => {
    const { messages } = resolvePartners(
      unit({ noDefault: true }),
      'UNIT-STUTTGART',
      null,
    );
    expect(messages.map((m) => m.code)).toEqual(['NO_DEFAULT_SHIP_TO']);
  });

  it('reports an unknown unit without partners', () => {
    expect(resolvePartners(null, 'NOPE', null)).toEqual({
      partners: null,
      messages: [
        {
          severity: 'ERROR',
          code: 'UNIT_NOT_FOUND',
          text: 'B2B unit NOPE does not exist.',
          field: 'unitId',
        },
      ],
    });
  });

  it('reports an inactive unit as inactive master data', () => {
    const { messages } = resolvePartners(
      unit({ isActive: false }),
      'UNIT-STUTTGART',
      null,
    );
    expect(messages).toEqual([
      expect.objectContaining({
        code: 'MASTER_DATA_INACTIVE',
        field: 'unitId',
      }),
    ]);
  });

  it('names every partner role of an inactive customer', () => {
    const { messages } = resolvePartners(
      unit({ inactive: ['CUST-1000'] }),
      'UNIT-STUTTGART',
      null,
    );
    expect(messages.map((m) => [m.code, m.field])).toEqual([
      ['MASTER_DATA_INACTIVE', 'account'],
      ['MASTER_DATA_INACTIVE', 'soldTo'],
      ['MASTER_DATA_INACTIVE', 'billTo'],
      ['MASTER_DATA_INACTIVE', 'payer'],
    ]);
    expect(messages[2].text).toBe(
      'Bill-to CUST-1000 (Customer CUST-1000) is inactive.',
    );
  });

  it('reports an inactive Ship-to', () => {
    const { messages } = resolvePartners(
      unit({ inactive: ['CUST-1100'] }),
      'UNIT-STUTTGART',
      null,
    );
    expect(messages.map((m) => [m.code, m.field])).toEqual([
      ['MASTER_DATA_INACTIVE', 'shipTo'],
    ]);
  });
});

describe('buildItems', () => {
  it('numbers the positions 10, 20, 30 in request order', () => {
    const { items: result } = items([
      ['MAT-002', 10, '189.50'],
      ['MAT-001', 2, '4500.00'],
      ['MAT-002', 5, '189.50'],
    ]);
    expect(
      result.map((i) => [
        i.itemNumber,
        i.materialNumber,
        i.quantity,
        i.netValue,
      ]),
    ).toEqual([
      [10, 'MAT-002', 10, '1895.00'],
      [20, 'MAT-001', 2, '9000.00'],
      [30, 'MAT-002', 5, '947.50'],
    ]);
  });

  it('marks an unknown material at its position without a price', () => {
    const { items: result } = items([
      ['MAT-001', 2, '4500.00'],
      ['MAT-XXX', 1, null],
    ]);
    expect(result[1]).toEqual({
      itemNumber: 20,
      materialNumber: 'MAT-XXX',
      materialDescription: null,
      quantity: 1,
      unitPrice: null,
      netValue: null,
      currency: null,
      pricing: null,
      messages: [
        {
          severity: 'ERROR',
          code: 'MATERIAL_NOT_FOUND',
          text: 'Material MAT-XXX does not exist.',
          field: 'materialNumber',
        },
      ],
    });
  });
});

describe('sameMaterialMessages', () => {
  it('reports the same material in several items as INFO', () => {
    const { items: result } = items([
      ['MAT-002', 10, '189.50'],
      ['MAT-001', 2, '4500.00'],
      ['MAT-002', 5, '189.50'],
      ['MAT-002', 1, '189.50'],
    ]);
    expect(sameMaterialMessages(result)).toEqual([
      {
        severity: 'INFO',
        code: 'SAME_MATERIAL_IN_SEVERAL_ITEMS',
        text: 'Material MAT-002 appears in items 10, 30 and 40. Each item is kept and priced separately.',
      },
    ]);
  });

  it('reports nothing for different materials', () => {
    const { items: result } = items([
      ['MAT-001', 1, '1.00'],
      ['MAT-002', 1, '1.00'],
    ]);
    expect(sameMaterialMessages(result)).toEqual([]);
  });
});

describe('currencyMessages', () => {
  it('accepts one currency', () => {
    expect(
      currencyMessages(
        items([
          ['A', 1, '1.00'],
          ['B', 1, '2.00'],
        ]).items,
      ),
    ).toEqual([]);
  });

  it('rejects mixed currencies and names the items', () => {
    const { items: result } = items([
      ['A', 1, '1.00', 'EUR'],
      ['B', 1, '2.00', 'CHF'],
      ['C', 1, '3.00', 'EUR'],
    ]);
    expect(currencyMessages(result)).toEqual([
      {
        severity: 'ERROR',
        code: 'MIXED_CURRENCIES',
        text: 'All items of an order must have the same currency. Found EUR (items 10 and 30), CHF (items 20).',
      },
    ]);
  });

  it('ignores positions without a price', () => {
    expect(
      currencyMessages(
        items([
          ['A', 1, '1.00'],
          ['X', 1, null],
        ]).items,
      ),
    ).toEqual([]);
  });
});

describe('customerNoteResult', () => {
  it('needs no review without a note', () => {
    expect(customerNoteResult(null)).toEqual({
      requiresSalesReview: false,
      proposedOrderBlock: null,
      messages: [],
    });
  });

  it('proposes delivery block SALES_REVIEW as a warning for a note', () => {
    const result = customerNoteResult('Bitte nur über Tor 3 anliefern.');
    expect(result.requiresSalesReview).toBe(true);
    expect(result.proposedOrderBlock).toMatchObject({
      type: 'DELIVERY_BLOCK',
      code: 'SALES_REVIEW',
      reason: 'CUSTOMER_NOTE',
    });
    expect(result.proposedOrderBlock?.description).toMatch(
      /^If this order is placed, it will receive/,
    );
    expect(result.messages).toEqual([
      expect.objectContaining({
        severity: 'WARNING',
        code: 'SALES_REVIEW_REQUIRED',
        field: 'customerNote',
      }),
    ]);
  });
});

describe('shippingMessages', () => {
  it('only informs about Express without promising anything', () => {
    expect(shippingMessages(RequestedShippingMethod.STANDARD)).toEqual([]);
    const [info] = shippingMessages(RequestedShippingMethod.EXPRESS);
    expect(info).toMatchObject({ severity: 'INFO', code: 'EXPRESS_REQUESTED' });
    expect(info.text).toContain('not confirmed');
  });
});

describe('simulationStatus and totals', () => {
  const info = { severity: 'INFO' as const, code: 'I', text: 'i' };
  const warning = { severity: 'WARNING' as const, code: 'W', text: 'w' };
  const err = { severity: 'ERROR' as const, code: 'E', text: 'e' };

  it('derives the status from the most severe message', () => {
    const { items: ok } = items([['A', 1, '1.00']]);
    const { items: broken } = items([['X', 1, null]]);
    expect(simulationStatus([], ok)).toBe('VALID');
    expect(simulationStatus([info], ok)).toBe('VALID');
    expect(simulationStatus([info, warning], ok)).toBe('VALID_WITH_WARNINGS');
    expect(simulationStatus([warning, err], ok)).toBe('INVALID');
    expect(simulationStatus([], broken)).toBe('INVALID');
  });

  it('sums the Müller order exactly', () => {
    const built = items([
      ['MAT-001', 2, '4500.00'],
      ['MAT-002', 10, '189.50'],
    ]);
    expect(totalsOf('VALID', built.items, built.netValues)).toEqual({
      netValue: '10895.00',
      currency: 'EUR',
      includes: 'NET_EXCL_TAX_AND_FREIGHT',
    });
  });

  it('adds many small amounts without floating-point error', () => {
    const built = items(
      Array.from({ length: 200 }, (_, i): [string, number, string] => [
        `M${i}`,
        3,
        '0.10',
      ]),
    );
    // 200 x 0.30; as JavaScript numbers this sum would not be exact
    expect(totalsOf('VALID', built.items, built.netValues)?.netValue).toBe(
      '60.00',
    );
  });

  it('returns no total for an invalid simulation', () => {
    const built = items([
      ['A', 1, '1.00'],
      ['X', 1, null],
    ]);
    expect(totalsOf('INVALID', built.items, built.netValues)).toBeNull();
  });
});

describe('checksOf', () => {
  it('lists the performed and the not performed checks', () => {
    const { items: result } = items([['A', 1, '1.00']]);
    const checks = checksOf([], result, []);
    expect(checks.map((c) => `${c.check}:${c.result}`)).toEqual([
      'PARTNERS:PASSED',
      'MATERIALS:PASSED',
      'PRICING:PASSED',
      'CURRENCY:PASSED',
      'AVAILABILITY:NOT_PERFORMED',
      'DELIVERY_DATE:NOT_PERFORMED',
      'FREIGHT:NOT_PERFORMED',
      'TAX:NOT_PERFORMED',
      'CREDIT:NOT_PERFORMED',
      'CUSTOMER_BLOCKS:NOT_PERFORMED',
      'MINIMUM_ORDER_VALUE:NOT_PERFORMED',
    ]);
    expect(
      checks.filter((c) => c.result === 'NOT_PERFORMED').every((c) => c.text),
    ).toBe(true);
  });

  it('marks failed checks', () => {
    const { items: result } = items([['X', 1, null]]);
    const checks = checksOf(
      [{ severity: 'ERROR', code: 'UNIT_NOT_FOUND', text: 't' }],
      result,
      [],
    );
    expect(checks.slice(0, 4).map((c) => `${c.check}:${c.result}`)).toEqual([
      'PARTNERS:FAILED',
      'MATERIALS:FAILED',
      'PRICING:FAILED',
      'CURRENCY:NOT_PERFORMED',
    ]);
  });
});

describe('requestedDeliveryDateMessages', () => {
  it('reports nothing without a requested date', () => {
    expect(requestedDeliveryDateMessages(null, '2026-10-29')).toEqual([]);
  });

  it.each(['2026-10-29', '2026-11-20', '2027-03-01'])(
    'only informs that %s is not confirmed',
    (date) => {
      const [info] = requestedDeliveryDateMessages(date, '2026-10-29');
      expect(info).toMatchObject({
        severity: 'INFO',
        code: 'REQUESTED_DELIVERY_DATE_NOT_CONFIRMED',
        field: 'requestedDeliveryDate',
      });
      expect(info.text).toContain('not confirmed');
    },
  );

  it('rejects a date before the order date', () => {
    expect(requestedDeliveryDateMessages('2026-10-28', '2026-10-29')).toEqual([
      {
        severity: 'ERROR',
        code: 'REQUESTED_DELIVERY_DATE_BEFORE_ORDER_DATE',
        text: 'The requested delivery date 2026-10-28 is before the order date 2026-10-29.',
        field: 'requestedDeliveryDate',
      },
    ]);
  });
});
