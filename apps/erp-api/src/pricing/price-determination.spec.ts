import { Prisma } from '../generated/prisma/client';
import {
  ConditionCandidate,
  determinePrice,
  DeterminationInput,
} from './price-determination';

const d = (value: string) => new Prisma.Decimal(value);

function condition(
  conditionId: number,
  changes: Partial<ConditionCandidate> = {},
): ConditionCandidate {
  return {
    conditionId,
    scope: 'SOLD_TO',
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
    basePrice: d('100.00'),
    currency: 'EUR',
    candidates: [],
    ...changes,
  };
}

/** The result with amounts as text, easier to compare */
function priceOf(changes: Partial<DeterminationInput>) {
  const result = determinePrice(input(changes));
  return {
    source: result.source,
    conditionId: result.condition?.conditionId ?? null,
    unitPrice: result.unitPrice.toFixed(2),
    netValue: result.netValue.toFixed(2),
  };
}

const UNIT_PRICE = condition(1, { scope: 'B2B_UNIT', amount: d('80.00') });
const SOLD_TO_PRICE = condition(2, { scope: 'SOLD_TO', amount: d('90.00') });

describe('determinePrice', () => {
  describe('priority', () => {
    it('should use the B2B unit price before the Sold-to price', () => {
      expect(priceOf({ candidates: [SOLD_TO_PRICE, UNIT_PRICE] })).toEqual({
        source: 'B2B_UNIT',
        conditionId: 1,
        unitPrice: '80.00',
        netValue: '80.00',
      });
    });

    it('should use the Sold-to price when there is no unit price', () => {
      expect(priceOf({ candidates: [SOLD_TO_PRICE] })).toMatchObject({
        source: 'SOLD_TO',
        conditionId: 2,
        unitPrice: '90.00',
      });
    });

    it('should fall back to the base price', () => {
      expect(priceOf({ candidates: [] })).toEqual({
        source: 'BASE_PRICE',
        conditionId: null,
        unitPrice: '100.00',
        netValue: '100.00',
      });
    });

    it('should use the higher level even if its price is higher', () => {
      const expensive = condition(3, {
        scope: 'B2B_UNIT',
        amount: d('120.00'),
      });
      expect(priceOf({ candidates: [SOLD_TO_PRICE, expensive] })).toMatchObject(
        { source: 'B2B_UNIT', unitPrice: '120.00' },
      );
    });

    it('should report every level and mark only the winner as applied', () => {
      const result = determinePrice(
        input({ candidates: [UNIT_PRICE, SOLD_TO_PRICE] }),
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
          source: 'BASE_PRICE',
          conditionId: null,
          amount: '100.00',
          applied: false,
        },
      ]);
    });

    it('should report levels without a valid condition as empty', () => {
      const result = determinePrice(input({ candidates: [] }));
      expect(
        result.steps.map((s) => [s.source, s.conditionId, s.applied]),
      ).toEqual([
        ['B2B_UNIT', null, false],
        ['SOLD_TO', null, false],
        ['BASE_PRICE', null, true],
      ]);
    });

    it('should not depend on the order of the candidates', () => {
      const a = priceOf({ candidates: [UNIT_PRICE, SOLD_TO_PRICE] });
      const b = priceOf({ candidates: [SOLD_TO_PRICE, UNIT_PRICE] });
      expect(a).toEqual(b);
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
      ['the day before', '2026-02-28', 'BASE_PRICE'],
      ['the day after', '2026-04-01', 'BASE_PRICE'],
    ])('should handle %s', (_case, pricingDate, source) => {
      expect(priceOf({ pricingDate, candidates: [limited] }).source).toBe(
        source,
      );
    });

    it('should treat a missing end as open-ended', () => {
      expect(
        priceOf({ pricingDate: '9999-12-31', candidates: [SOLD_TO_PRICE] })
          .source,
      ).toBe('SOLD_TO');
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
      expect(priceOf({ candidates: [inactive, SOLD_TO_PRICE] })).toMatchObject({
        source: 'SOLD_TO',
        conditionId: 2,
      });
    });

    it('should fall through to the Sold-to when the unit price expired', () => {
      const expired = condition(9, {
        scope: 'B2B_UNIT',
        validFrom: '2025-01-01',
        validTo: '2025-12-31',
      });
      expect(priceOf({ candidates: [expired, SOLD_TO_PRICE] }).source).toBe(
        'SOLD_TO',
      );
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
        }).netValue,
      ).toBe(netValue);
    });
  });

  describe('inconsistent data', () => {
    it('should fail instead of choosing between two valid conditions of one level', () => {
      expect(() =>
        determinePrice(input({ candidates: [condition(11), condition(12)] })),
      ).toThrow(
        'Price conditions 11, 12 (SOLD_TO) are all valid on 2026-06-15',
      );
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

    it('should fail for a valid condition in another currency', () => {
      expect(() =>
        determinePrice(
          input({ candidates: [condition(15, { currency: 'USD' })] }),
        ),
      ).toThrow('Price condition 15 uses USD, but the material uses EUR');
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
    const result = determinePrice(
      input({
        baseConditionType: zp01,
        candidates: [
          { ...SOLD_TO_PRICE, conditionType: zp03 },
          { ...UNIT_PRICE, conditionType: zp02 },
        ],
      }),
    );
    expect(result.conditionType).toEqual(zp02);
    expect(result.steps.map((s) => s.conditionType?.code ?? null)).toEqual([
      'ZP02',
      'ZP03',
      'ZP01',
    ]);
  });

  it('shows ZP01 for the base price and null for empty levels', () => {
    const result = determinePrice(input({ baseConditionType: zp01 }));
    expect(result.conditionType).toEqual(zp01);
    expect(result.steps.map((s) => s.conditionType?.code ?? null)).toEqual([
      null,
      null,
      'ZP01',
    ]);
  });

  it('never lets the condition type change the precedence', () => {
    // A "special price" on the Sold-to level does not beat the unit level
    const result = determinePrice(
      input({
        candidates: [
          { ...SOLD_TO_PRICE, amount: d('50.00'), conditionType: zp03 },
          { ...UNIT_PRICE, conditionType: zp02 },
        ],
      }),
    );
    expect(result.source).toBe('B2B_UNIT');
    expect(result.unitPrice.toFixed(2)).toBe('80.00');
  });

  it('still prices without any condition type metadata', () => {
    const result = determinePrice(input({ candidates: [SOLD_TO_PRICE] }));
    expect(result.unitPrice.toFixed(2)).toBe('90.00');
    expect(result.conditionType).toBeNull();
  });
});
