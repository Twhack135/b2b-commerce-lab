import { Prisma } from '../../generated/prisma/client';
import {
  Access,
  assertInSalesArea,
  ConditionCandidate,
  evaluateAccessSequence,
} from './access-sequence';

const GERMANY = {
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
};
const EUR = { code: 'EUR', decimals: 2 };
const type = (code: string) =>
  ({
    code,
    name: code,
    conditionClass: 'PRICE',
    calculationType: 'QUANTITY',
  }) as never;

/** ZBP1 of migration 20261105120000_add_pricing_procedures */
const ZBP1: Access[] = [
  { accessNumber: 10, conditionTypeCode: 'ZP03', scope: 'B2B_UNIT' },
  { accessNumber: 20, conditionTypeCode: 'ZP02', scope: 'B2B_UNIT' },
  { accessNumber: 30, conditionTypeCode: 'ZP03', scope: 'SOLD_TO' },
  { accessNumber: 40, conditionTypeCode: 'ZP02', scope: 'SOLD_TO' },
  { accessNumber: 50, conditionTypeCode: 'ZP01', scope: 'SALES_AREA' },
];

let id = 100;
const record = (
  code: string,
  scope: ConditionCandidate['scope'],
  amount: string,
  overrides: Partial<ConditionCandidate> = {},
): ConditionCandidate => ({
  conditionId: id++,
  scope,
  salesArea: GERMANY,
  amount: new Prisma.Decimal(amount),
  currency: 'EUR',
  validFrom: '1900-01-01',
  validTo: null,
  isActive: true,
  conditionType: type(code),
  ...overrides,
});
const evaluate = (
  candidates: ConditionCandidate[],
  pricingDate = '2026-11-10',
) =>
  evaluateAccessSequence({
    accesses: ZBP1,
    candidates,
    pricingDate,
    salesArea: GERMANY,
    currency: EUR,
  });

describe('evaluateAccessSequence with typed accesses (ZBP1)', () => {
  it('keeps the level order: B2B unit before Sold-to before sales area', () => {
    const unit = record('ZP02', 'B2B_UNIT', '179.00');
    const soldTo = record('ZP03', 'SOLD_TO', '170.00');
    const result = evaluate([
      record('ZP01', 'SALES_AREA', '199.00'),
      soldTo,
      unit,
    ]);
    expect(result.winner).toBe(unit);
    expect(
      result.outcomes.map((o) => [
        o.access.accessNumber,
        o.match?.conditionId ?? null,
        o.applied,
      ]),
    ).toEqual([
      [10, null, false],
      [20, unit.conditionId, true],
      // Found, but not used: the unit price comes first (pricing analysis)
      [30, soldTo.conditionId, false],
      [40, null, false],
      [50, expect.any(Number), false],
    ]);
  });

  it('prefers ZP03 over ZP02 within one level', () => {
    const zp02 = record('ZP02', 'SOLD_TO', '189.50');
    const zp03 = record('ZP03', 'SOLD_TO', '180.00');
    expect(evaluate([zp02, zp03]).winner).toBe(zp03);
    // Without a valid ZP03, the ZP02 of the same level
    expect(evaluate([zp02, { ...zp03, validTo: '2026-11-09' }]).winner).toBe(
      zp02,
    );
  });

  it('only reads the condition type of each access', () => {
    // A ZP01 on the Sold-to level is no access of ZBP1
    expect(evaluate([record('ZP01', 'SOLD_TO', '1.00')]).winner).toBeNull();
  });

  it('refuses two valid records of one access, naming type and level', () => {
    const a = record('ZP02', 'SOLD_TO', '1.00');
    const b = record('ZP02', 'SOLD_TO', '2.00');
    expect(() => evaluate([a, b])).toThrow(
      `Price conditions ${a.conditionId}, ${b.conditionId} (ZP02 SOLD_TO) are all valid on 2026-11-10`,
    );
  });

  it('refuses other currencies, too many decimals and other sales areas', () => {
    expect(() =>
      evaluate([record('ZP01', 'SALES_AREA', '1.00', { currency: 'PLN' })]),
    ).toThrow('uses PLN');
    expect(() =>
      evaluateAccessSequence({
        accesses: ZBP1,
        candidates: [record('ZP01', 'SALES_AREA', '1.50', { currency: 'JPY' })],
        pricingDate: '2026-11-10',
        salesArea: GERMANY,
        currency: { code: 'JPY', decimals: 0 },
      }),
    ).toThrow('more decimal places than JPY allows');
    expect(() =>
      assertInSalesArea(
        [
          record('ZP01', 'SALES_AREA', '1.00', {
            salesArea: { ...GERMANY, salesOrganization: '2000' },
          }),
        ],
        GERMANY,
      ),
    ).toThrow('belongs to sales area 2000/10/00, not 1000/10/00');
  });
});
