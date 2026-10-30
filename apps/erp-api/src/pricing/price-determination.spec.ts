import { Prisma } from '../generated/prisma/client';
import {
  ConditionCandidate,
  Determination,
  determinePrice,
  DeterminationInput,
} from './price-determination';

const d = (value: string) => new Prisma.Decimal(value);

// Configured like the sales areas: Germany EUR, Poland PLN, Japan JPY
const GERMANY = {
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
};
const POLAND = { ...GERMANY, salesOrganization: '2000' };
const JAPAN = { ...GERMANY, salesOrganization: '3000' };
const EUR = { code: 'EUR', decimals: 2 };
const PLN = { code: 'PLN', decimals: 2 };
const JPY = { code: 'JPY', decimals: 0 };

function condition(
  conditionId: number,
  changes: Partial<ConditionCandidate> = {},
): ConditionCandidate {
  return {
    conditionId,
    scope: 'SOLD_TO',
    salesArea: GERMANY,
    amount: d('90.00'),
    currency: 'EUR',
    validFrom: '2026-01-01',
    validTo: null,
    isActive: true,
    ...changes,
  };
}

function input(changes: Partial<DeterminationInput> = {}): DeterminationInput {
  return {
    pricingDate: '2026-06-15',
    quantity: 1,
    salesArea: GERMANY,
    currency: EUR,
    candidates: [LIST_PRICE],
    ...changes,
  };
}

/** The result with amounts as text, easier to compare */
function priceOf(changes: Partial<DeterminationInput>) {
  const result = determinePrice(input(changes));
  if (result.status !== 'PRICED') return { status: result.status };
  return {
    source: result.source,
    conditionId: result.condition.conditionId,
    unitPrice: result.unitPrice.toFixed(2),
    netValue: result.netValue.toFixed(2),
  };
}

function priced(result: Determination) {
  if (result.status !== 'PRICED') throw new Error('expected a price');
  return result;
}

const UNIT_PRICE = condition(1, { scope: 'B2B_UNIT', amount: d('80.00') });
const SOLD_TO_PRICE = condition(2, { scope: 'SOLD_TO', amount: d('90.00') });
const LIST_PRICE = condition(3, {
  scope: 'SALES_AREA',
  amount: d('100.00'),
  validFrom: '1900-01-01',
});

describe('determinePrice', () => {
  describe('priority: B2B unit, Sold-to, list price of the sales area', () => {
    it('should use the B2B unit price before the Sold-to and list price', () => {
      expect(
        priceOf({ candidates: [LIST_PRICE, SOLD_TO_PRICE, UNIT_PRICE] }),
      ).toEqual({
        source: 'B2B_UNIT',
        conditionId: 1,
        unitPrice: '80.00',
        netValue: '80.00',
      });
    });

    it('should use the Sold-to price when there is no unit price', () => {
      expect(
        priceOf({ candidates: [LIST_PRICE, SOLD_TO_PRICE] }),
      ).toMatchObject({
        source: 'SOLD_TO',
        conditionId: 2,
        unitPrice: '90.00',
      });
    });

    it('should fall back to the list price (ZP01) of the sales area', () => {
      expect(priceOf({ candidates: [LIST_PRICE] })).toEqual({
        source: 'SALES_AREA',
        conditionId: 3,
        unitPrice: '100.00',
        netValue: '100.00',
      });
    });

    it('should use a customer price even without a list price', () => {
      expect(priceOf({ candidates: [SOLD_TO_PRICE] })).toMatchObject({
        source: 'SOLD_TO',
        unitPrice: '90.00',
      });
    });

    it('should use the higher level even if its price is higher', () => {
      const expensive = condition(4, {
        scope: 'B2B_UNIT',
        amount: d('120.00'),
      });
      expect(
        priceOf({ candidates: [LIST_PRICE, SOLD_TO_PRICE, expensive] }),
      ).toMatchObject({ source: 'B2B_UNIT', unitPrice: '120.00' });
    });

    it('should report every level and mark only the winner as applied', () => {
      const result = determinePrice(
        input({ candidates: [UNIT_PRICE, SOLD_TO_PRICE, LIST_PRICE] }),
      );
      expect(
        result.steps.map((s) => ({
          source: s.source,
          conditionId: s.conditionId,
          amount: s.amount?.toFixed(2) ?? null,
          applied: s.applied,
        })),
      ).toEqual([
        { source: 'B2B_UNIT', conditionId: 1, amount: '80.00', applied: true },
        { source: 'SOLD_TO', conditionId: 2, amount: '90.00', applied: false },
        {
          source: 'SALES_AREA',
          conditionId: 3,
          amount: '100.00',
          applied: false,
        },
      ]);
    });

    it('should not depend on the order of the candidates', () => {
      const a = priceOf({
        candidates: [UNIT_PRICE, SOLD_TO_PRICE, LIST_PRICE],
      });
      const b = priceOf({
        candidates: [LIST_PRICE, SOLD_TO_PRICE, UNIT_PRICE],
      });
      expect(a).toEqual(b);
    });
  });

  describe('no price', () => {
    it('should report NO_PRICE_FOUND when no level has a valid condition', () => {
      const result = determinePrice(input({ candidates: [] }));
      expect(result).toEqual({
        status: 'NO_PRICE_FOUND',
        currency: 'EUR',
        steps: [
          {
            source: 'B2B_UNIT',
            conditionId: null,
            amount: null,
            applied: false,
            conditionType: null,
          },
          {
            source: 'SOLD_TO',
            conditionId: null,
            amount: null,
            applied: false,
            conditionType: null,
          },
          {
            source: 'SALES_AREA',
            conditionId: null,
            amount: null,
            applied: false,
            conditionType: null,
          },
        ],
      });
    });

    it('should report NO_PRICE_FOUND when the list price is not valid yet', () => {
      const future = condition(5, {
        scope: 'SALES_AREA',
        validFrom: '2027-01-01',
      });
      expect(priceOf({ candidates: [future] })).toEqual({
        status: 'NO_PRICE_FOUND',
      });
    });

    it('should report NO_PRICE_FOUND when all conditions are inactive', () => {
      expect(
        priceOf({
          candidates: [
            { ...LIST_PRICE, isActive: false },
            { ...SOLD_TO_PRICE, isActive: false },
          ],
        }),
      ).toEqual({ status: 'NO_PRICE_FOUND' });
    });
  });

  describe('validity period', () => {
    const limited = condition(5, {
      validFrom: '2026-03-01',
      validTo: '2026-03-31',
    });

    it.each([
      ['the first day', '2026-03-01', 'SOLD_TO'],
      ['a day in between', '2026-03-15', 'SOLD_TO'],
      ['the last day (inclusive)', '2026-03-31', 'SOLD_TO'],
      ['the day before', '2026-02-28', 'SALES_AREA'],
      ['the day after', '2026-04-01', 'SALES_AREA'],
    ])('should handle %s', (_case, pricingDate, source) => {
      expect(
        priceOf({ pricingDate, candidates: [limited, LIST_PRICE] }),
      ).toMatchObject({ source });
    });

    it('should treat a missing end as open-ended', () => {
      expect(
        priceOf({ pricingDate: '9999-12-31', candidates: [SOLD_TO_PRICE] }),
      ).toMatchObject({ source: 'SOLD_TO' });
    });

    it('should find the migrated list price on any date since 1900', () => {
      expect(
        priceOf({ pricingDate: '1900-01-01', candidates: [LIST_PRICE] }),
      ).toMatchObject({ source: 'SALES_AREA', unitPrice: '100.00' });
    });

    it('should find the condition of the right period', () => {
      const candidates = [
        condition(6, {
          validFrom: '2026-01-01',
          validTo: '2026-06-30',
          amount: d('91.00'),
        }),
        condition(7, { validFrom: '2026-07-01', amount: d('95.00') }),
      ];
      expect(priceOf({ pricingDate: '2026-06-30', candidates })).toMatchObject({
        conditionId: 6,
        unitPrice: '91.00',
      });
      expect(priceOf({ pricingDate: '2026-07-01', candidates })).toMatchObject({
        conditionId: 7,
        unitPrice: '95.00',
      });
    });

    it('should ignore inactive conditions', () => {
      const inactive = condition(8, { scope: 'B2B_UNIT', isActive: false });
      expect(
        priceOf({ candidates: [inactive, SOLD_TO_PRICE, LIST_PRICE] }),
      ).toMatchObject({ source: 'SOLD_TO', conditionId: 2 });
    });

    it('should fall through to the Sold-to when the unit price expired', () => {
      const expired = condition(9, {
        scope: 'B2B_UNIT',
        validFrom: '2025-01-01',
        validTo: '2025-12-31',
      });
      expect(
        priceOf({ candidates: [expired, SOLD_TO_PRICE, LIST_PRICE] }),
      ).toMatchObject({ source: 'SOLD_TO' });
    });
  });

  describe('exact decimal calculation', () => {
    it.each([
      ['0.10', 3, '0.30'],
      ['0.01', 99999, '999.99'],
      ['19.99', 7, '139.93'],
      ['4500.00', 2, '9000.00'],
      ['9999999999.99', 99999, '999989999999000.01'],
    ])('%s x %d = %s', (amount, quantity, netValue) => {
      expect(
        priceOf({
          quantity,
          candidates: [condition(10, { amount: d(amount) })],
        }),
      ).toMatchObject({ netValue });
    });
  });

  describe('currencies of the sales areas', () => {
    it('should price in PLN with two decimal places', () => {
      const result = priced(
        determinePrice(
          input({
            salesArea: POLAND,
            currency: PLN,
            quantity: 3,
            candidates: [
              condition(20, {
                scope: 'SALES_AREA',
                salesArea: POLAND,
                currency: 'PLN',
                amount: d('1899.99'),
              }),
            ],
          }),
        ),
      );
      expect([result.currency, result.netValue.toFixed(2)]).toEqual([
        'PLN',
        '5699.97',
      ]);
    });

    it('should price in JPY without decimal places', () => {
      const result = priced(
        determinePrice(
          input({
            salesArea: JAPAN,
            currency: JPY,
            quantity: 99999,
            candidates: [
              condition(21, {
                scope: 'SALES_AREA',
                salesArea: JAPAN,
                currency: 'JPY',
                amount: d('700000'),
              }),
            ],
          }),
        ),
      );
      expect(result.currency).toBe('JPY');
      expect(result.netValue.toFixed()).toBe('69999300000');
      expect(result.netValue.decimalPlaces()).toBe(0);
    });

    it('should accept a JPY amount stored with zero decimals (700000.00)', () => {
      const result = priced(
        determinePrice(
          input({
            salesArea: JAPAN,
            currency: JPY,
            candidates: [
              condition(22, {
                scope: 'SALES_AREA',
                salesArea: JAPAN,
                currency: 'JPY',
                amount: d('700000.00'),
              }),
            ],
          }),
        ),
      );
      expect(result.unitPrice.toFixed(0)).toBe('700000');
    });

    it('should fail for a JPY amount with decimal places', () => {
      expect(() =>
        determinePrice(
          input({
            salesArea: JAPAN,
            currency: JPY,
            candidates: [
              condition(23, {
                scope: 'SALES_AREA',
                salesArea: JAPAN,
                currency: 'JPY',
                amount: d('4400.50'),
              }),
            ],
          }),
        ),
      ).toThrow('Price condition 23 has more decimal places than JPY allows');
    });
  });

  describe('market isolation and inconsistent data', () => {
    it('should fail for a candidate of another sales area, even if it is not valid', () => {
      const polish = condition(30, {
        salesArea: POLAND,
        currency: 'PLN',
        isActive: false,
      });
      expect(() =>
        determinePrice(input({ candidates: [LIST_PRICE, polish] })),
      ).toThrow(
        'Price condition 30 belongs to sales area 2000/10/00, not 1000/10/00',
      );
    });

    it('should fail for a valid condition in another currency', () => {
      expect(() =>
        determinePrice(
          input({ candidates: [condition(15, { currency: 'PLN' })] }),
        ),
      ).toThrow(
        'Price condition 15 uses PLN, but sales area 1000/10/00 uses EUR',
      );
    });

    it('should fail instead of choosing between two valid conditions of one level', () => {
      expect(() =>
        determinePrice(input({ candidates: [condition(11), condition(12)] })),
      ).toThrow(
        'Price conditions 11, 12 (SOLD_TO) are all valid on 2026-06-15',
      );
    });

    it('should fail for two valid list prices', () => {
      expect(() =>
        determinePrice(
          input({
            candidates: [LIST_PRICE, { ...LIST_PRICE, conditionId: 31 }],
          }),
        ),
      ).toThrow('Price conditions 3, 31 (SALES_AREA) are all valid');
    });

    it('should not fail for two conditions that are valid on different days', () => {
      expect(() =>
        determinePrice(
          input({
            candidates: [
              condition(13, { validTo: '2026-06-14' }),
              condition(14, { validFrom: '2026-06-15' }),
            ],
          }),
        ),
      ).not.toThrow();
    });
  });
});

describe('condition type metadata', () => {
  const zp01 = {
    code: 'ZP01',
    name: 'List Price',
    conditionClass: 'PRICE',
    calculationType: 'QUANTITY',
  } as const;
  const zp02 = {
    code: 'ZP02',
    name: 'Customer Net Price',
    conditionClass: 'PRICE',
    calculationType: 'QUANTITY',
  } as const;
  const zp03 = {
    code: 'ZP03',
    name: 'Special Price',
    conditionClass: 'PRICE',
    calculationType: 'QUANTITY',
  } as const;

  it('carries the condition type of every level and of the used price', () => {
    const result = priced(
      determinePrice(
        input({
          candidates: [
            { ...LIST_PRICE, conditionType: zp01 },
            { ...SOLD_TO_PRICE, conditionType: zp03 },
            { ...UNIT_PRICE, conditionType: zp02 },
          ],
        }),
      ),
    );
    expect(result.conditionType).toEqual(zp02);
    expect(result.steps.map((s) => s.conditionType?.code ?? null)).toEqual([
      'ZP02',
      'ZP03',
      'ZP01',
    ]);
  });

  it('shows ZP01 for the list price and null for empty levels', () => {
    const result = priced(
      determinePrice(
        input({ candidates: [{ ...LIST_PRICE, conditionType: zp01 }] }),
      ),
    );
    expect(result.conditionType).toEqual(zp01);
    expect(result.steps.map((s) => s.conditionType?.code ?? null)).toEqual([
      null,
      null,
      'ZP01',
    ]);
  });

  it('never lets the condition type change the precedence', () => {
    // A "special price" on the Sold-to level does not beat the unit level
    const result = priced(
      determinePrice(
        input({
          candidates: [
            { ...SOLD_TO_PRICE, amount: d('50.00'), conditionType: zp03 },
            { ...UNIT_PRICE, conditionType: zp02 },
          ],
        }),
      ),
    );
    expect(result.source).toBe('B2B_UNIT');
    expect(result.unitPrice.toFixed(2)).toBe('80.00');
  });

  it('still prices without any condition type metadata', () => {
    const result = priced(
      determinePrice(input({ candidates: [SOLD_TO_PRICE] })),
    );
    expect(result.unitPrice.toFixed(2)).toBe('90.00');
    expect(result.conditionType).toBeNull();
  });
});
