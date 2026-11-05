import { Prisma } from '../generated/prisma/client';
import { PriceConditionScope } from '../generated/prisma/enums';
import { fitsCurrency, roundToCurrency } from '../common/money';
import {
  formatSalesArea,
  SalesAreaKey,
  sameSalesArea,
} from '../sales-areas/sales-area-key';
import {
  ConditionCandidate,
  DeterminationInput,
  determinePrice,
} from './price-determination';

// Regression fixtures of the base price determination (Sprint 13A-2),
// written BEFORE it was moved onto the shared access sequence evaluator.
//
// LEGACY is a frozen, literal copy of determinePrice as it was released
// (Sprint 9C-B to 12C). Every input below must give exactly the same answer
// as LEGACY: the same result object, or the same error message. Do not
// change LEGACY; if a later sprint changes the behavior on purpose, that is
// a new decision with its own tests.

const LEGACY_ACCESS_SEQUENCE: readonly PriceConditionScope[] = [
  PriceConditionScope.B2B_UNIT,
  PriceConditionScope.SOLD_TO,
  PriceConditionScope.SALES_AREA,
];

function legacyIsValidOn(condition: ConditionCandidate, date: string) {
  return (
    condition.isActive &&
    condition.validFrom <= date &&
    (condition.validTo === null || date <= condition.validTo)
  );
}

function LEGACY(input: DeterminationInput) {
  const area = formatSalesArea(input.salesArea);
  for (const candidate of input.candidates) {
    if (!sameSalesArea(candidate.salesArea, input.salesArea)) {
      throw new Error(
        `Price condition ${candidate.conditionId} belongs to sales area ${formatSalesArea(candidate.salesArea)}, not ${area}`,
      );
    }
  }
  const steps: unknown[] = [];
  let winner: ConditionCandidate | null = null;
  for (const scope of LEGACY_ACCESS_SEQUENCE) {
    const valid = input.candidates.filter(
      (c) => c.scope === scope && legacyIsValidOn(c, input.pricingDate),
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
    netValue: roundToCurrency(
      winner.amount.mul(input.quantity),
      input.currency,
    ),
    currency: input.currency.code,
    conditionType: winner.conditionType ?? null,
    steps,
  };
}

/** The answer as comparable text: Decimals as strings, errors as messages */
function outcome(run: () => unknown): string {
  try {
    return JSON.stringify(run(), (_key, value: unknown) =>
      value instanceof Prisma.Decimal ? `D:${value.toString()}` : value,
    );
  } catch (error) {
    return `ERROR: ${(error as Error).message}`;
  }
}

function expectSameAsLegacy(input: DeterminationInput) {
  expect(outcome(() => determinePrice(input))).toBe(
    outcome(() => LEGACY(input)),
  );
}

const GERMANY: SalesAreaKey = {
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
};
const POLAND: SalesAreaKey = { ...GERMANY, salesOrganization: '2000' };
const JAPAN: SalesAreaKey = { ...GERMANY, salesOrganization: '3000' };
const EUR = { code: 'EUR', decimals: 2 };
const PLN = { code: 'PLN', decimals: 2 };
const JPY = { code: 'JPY', decimals: 0 };
const TYPES = {
  ZP01: {
    code: 'ZP01',
    name: 'List Price',
    conditionClass: 'PRICE',
    calculationType: 'QUANTITY',
  },
  ZP02: {
    code: 'ZP02',
    name: 'Customer Net Price',
    conditionClass: 'PRICE',
    calculationType: 'QUANTITY',
  },
  ZP03: {
    code: 'ZP03',
    name: 'Special Price',
    conditionClass: 'PRICE',
    calculationType: 'QUANTITY',
  },
} as const;

let nextId = 1;
const record = (
  scope: PriceConditionScope,
  amount: string,
  overrides: Partial<ConditionCandidate> = {},
): ConditionCandidate => ({
  conditionId: nextId++,
  scope,
  salesArea: GERMANY,
  amount: new Prisma.Decimal(amount),
  currency: 'EUR',
  validFrom: '1900-01-01',
  validTo: null,
  isActive: true,
  conditionType: (scope === 'SALES_AREA' ? TYPES.ZP01 : TYPES.ZP02) as never,
  ...overrides,
});
const input = (
  candidates: ConditionCandidate[],
  overrides: Partial<DeterminationInput> = {},
): DeterminationInput => ({
  pricingDate: '2026-11-10',
  quantity: 2,
  salesArea: GERMANY,
  currency: EUR,
  candidates,
  ...overrides,
});

describe('base price determination: regression against the released behavior', () => {
  it('Germany: special price of the Sold-to (ZP03 #4) over the list price', () => {
    expectSameAsLegacy(
      input([
        record('SALES_AREA', '4500.00'),
        record('SOLD_TO', '4400.00', {
          conditionType: TYPES.ZP03 as never,
          validFrom: '2026-10-29',
        }),
      ]),
    );
  });

  it('Germany: the unit price wins over Sold-to and list price', () => {
    expectSameAsLegacy(
      input(
        [
          record('SALES_AREA', '199.00'),
          record('SOLD_TO', '189.50'),
          record('B2B_UNIT', '179.00', { validFrom: '2026-06-15' }),
        ],
        { quantity: 10 },
      ),
    );
  });

  it('Poland: a list price only; Japan: amounts without decimals', () => {
    expectSameAsLegacy(
      input(
        [record('SALES_AREA', '45.50', { salesArea: POLAND, currency: 'PLN' })],
        { salesArea: POLAND, currency: PLN },
      ),
    );
    expectSameAsLegacy(
      input(
        [record('SALES_AREA', '700000', { salesArea: JAPAN, currency: 'JPY' })],
        { salesArea: JAPAN, currency: JPY, quantity: 3 },
      ),
    );
  });

  it('no price at all, and only invalid records', () => {
    expectSameAsLegacy(input([]));
    expectSameAsLegacy(
      input([
        record('SALES_AREA', '10.00', { isActive: false }),
        record('SOLD_TO', '9.00', { validFrom: '2026-11-11' }),
        record('B2B_UNIT', '8.00', { validTo: '2026-11-09' }),
      ]),
    );
  });

  it('validity boundaries are inclusive on both ends', () => {
    for (const [validFrom, validTo] of [
      ['2026-11-10', '2026-11-10'],
      ['2026-11-10', null],
      ['1900-01-01', '2026-11-10'],
      ['2026-11-11', null],
      ['1900-01-01', '2026-11-09'],
    ] as const) {
      expectSameAsLegacy(
        input([record('SOLD_TO', '5.00', { validFrom, validTo })]),
      );
    }
  });

  it('fails the same way on inconsistent data', () => {
    // Another sales area, another currency, too many decimals for JPY
    expectSameAsLegacy(
      input([record('SALES_AREA', '1.00', { salesArea: POLAND })]),
    );
    expectSameAsLegacy(
      input([record('SALES_AREA', '1.00', { currency: 'PLN' })]),
    );
    expectSameAsLegacy(
      input(
        [record('SALES_AREA', '1.50', { salesArea: JAPAN, currency: 'JPY' })],
        { salesArea: JAPAN, currency: JPY },
      ),
    );
    // Two valid records on one level (prevented by the database)
    expectSameAsLegacy(
      input([
        record('SOLD_TO', '1.00'),
        record('SOLD_TO', '2.00', { conditionType: TYPES.ZP03 as never }),
      ]),
    );
    // An invalid record of another currency is ignored, a valid one fails
    expectSameAsLegacy(
      input([
        record('SALES_AREA', '1.00', { currency: 'PLN', isActive: false }),
        record('SOLD_TO', '2.00'),
      ]),
    );
  });

  it('gives the same answer for 3000 generated inputs', () => {
    // A small deterministic generator (mulberry32): the same cases every run
    let seed = 0x13a2;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(values: readonly T[]): T =>
      values[Math.floor(random() * values.length)];
    const markets = [
      { area: GERMANY, currency: EUR },
      { area: POLAND, currency: PLN },
      { area: JAPAN, currency: JPY },
    ];
    const dates = [
      '2026-01-01',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2027-06-30',
    ];
    const scopes = ['B2B_UNIT', 'SOLD_TO', 'SALES_AREA'] as const;
    for (let run = 0; run < 3000; run++) {
      const market = pick(markets);
      const candidates = Array.from(
        { length: Math.floor(random() * 5) },
        (_, i) => {
          const scope = pick(scopes);
          const validFrom = pick(dates);
          const validTo = random() < 0.5 ? null : pick(dates);
          return {
            conditionId: run * 10 + i + 1,
            scope,
            // Mostly consistent data, sometimes another market or currency
            salesArea: random() < 0.03 ? pick(markets).area : market.area,
            amount: new Prisma.Decimal(
              pick([
                '0.01',
                '1',
                '45.5',
                '199.00',
                '700000',
                '4400.00',
                '12.345',
              ]),
            ),
            currency:
              random() < 0.03
                ? pick(markets).currency.code
                : market.currency.code,
            validFrom: validTo && validTo < validFrom ? validTo : validFrom,
            validTo,
            isActive: random() < 0.85,
            conditionType: (scope === 'SALES_AREA'
              ? TYPES.ZP01
              : pick([TYPES.ZP02, TYPES.ZP03])) as never,
          } satisfies ConditionCandidate;
        },
      );
      expectSameAsLegacy({
        pricingDate: pick(dates),
        quantity: 1 + Math.floor(random() * 50),
        salesArea: market.area,
        currency: market.currency,
        candidates,
      });
    }
  });
});
