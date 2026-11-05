import { Prisma } from '../../generated/prisma/client';
import { ConditionCandidate } from './access-sequence';
import {
  assertCalculable,
  calculateDocument,
  ProcedureAccess,
  ProcedureDefinition,
  ProcedureStepDefinition,
} from './procedure';

const GERMANY = {
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
};
const JAPAN = { ...GERMANY, salesOrganization: '3000' };
const EUR = { code: 'EUR', decimals: 2 };
const JPY = { code: 'JPY', decimals: 0 };
const type = (code: string, overrides: Record<string, string> = {}) =>
  ({
    code,
    name: code,
    conditionClass: 'PRICE',
    calculationType: 'QUANTITY',
    ...overrides,
  }) as never;
const access = (
  accessNumber: number,
  code: string,
  scope: ProcedureAccess['scope'],
): ProcedureAccess => ({
  accessNumber,
  conditionTypeCode: code,
  scope,
  materialSpecific: true,
  conditionType: type(code),
});

const ZBP1 = [
  access(10, 'ZP03', 'B2B_UNIT'),
  access(20, 'ZP02', 'B2B_UNIT'),
  access(30, 'ZP03', 'SOLD_TO'),
  access(40, 'ZP02', 'SOLD_TO'),
  access(50, 'ZP01', 'SALES_AREA'),
];
const conditionStep = (
  overrides: Partial<ProcedureStepDefinition>,
): ProcedureStepDefinition => ({
  stepNumber: 10,
  kind: 'CONDITION',
  label: 'Base price',
  accessSequenceCode: 'ZBP1',
  accesses: ZBP1,
  fromStep: null,
  toStep: null,
  statistical: false,
  mandatory: true,
  subtotalKey: null,
  ...overrides,
});
/** ZDE001 revision 1 of the migration */
const ZDE001: ProcedureDefinition = {
  code: 'ZDE001',
  name: 'B2B Germany',
  revision: 1,
  steps: [
    conditionStep({
      stepNumber: 5,
      label: 'List price',
      accessSequenceCode: 'ZLP1',
      accesses: [access(10, 'ZP01', 'SALES_AREA')],
      statistical: true,
      mandatory: false,
    }),
    conditionStep({}),
    {
      stepNumber: 100,
      kind: 'SUBTOTAL',
      label: 'Net value',
      accessSequenceCode: null,
      accesses: [],
      fromStep: 10,
      toStep: 99,
      statistical: false,
      mandatory: false,
      subtotalKey: 'NET_VALUE',
    },
  ],
};

let id = 1;
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
const document = (
  items: { candidates: ConditionCandidate[]; quantity?: number }[],
  extra: Partial<Parameters<typeof calculateDocument>[0]> = {},
) =>
  calculateDocument({
    procedure: ZDE001,
    salesArea: GERMANY,
    currency: EUR,
    pricingDate: '2026-11-10',
    items: items.map((item, index) => ({
      itemNumber: (index + 1) * 10,
      materialNumber: `MAT-${index + 1}`,
      quantity: item.quantity ?? 2,
      candidates: item.candidates,
    })),
    ...extra,
  });

describe('calculateDocument (pricing procedure, Sprint 13A)', () => {
  it('prices Stuttgart as the order simulation does: 8800.00 + 1895.00 = 10695.00 EUR', () => {
    const special = record('ZP03', 'SOLD_TO', '4400.00');
    const result = document([
      {
        candidates: [record('ZP01', 'SALES_AREA', '4500.00'), special],
        quantity: 2,
      },
      {
        candidates: [
          record('ZP01', 'SALES_AREA', '199.00'),
          record('ZP02', 'SOLD_TO', '189.50'),
        ],
        quantity: 10,
      },
    ]);
    expect(result.status).toBe('COMPLETE');
    expect(result.netValue?.toFixed(2)).toBe('10695.00');
    const [list, base, net] = result.items[0].lines;
    expect(list).toMatchObject({
      step: 5,
      statistical: true,
      value: new Prisma.Decimal('9000.00'),
    });
    expect(base).toMatchObject({
      step: 10,
      conditionId: special.conditionId,
      scope: 'SOLD_TO',
      rate: special.amount,
      value: new Prisma.Decimal('8800.00'),
    });
    // The statistical list price is shown, but not part of the net value
    expect(net).toMatchObject({
      step: 100,
      kind: 'SUBTOTAL',
      key: 'NET_VALUE',
      value: new Prisma.Decimal('8800.00'),
    });
    expect(result.items[0].netValue?.toFixed(2)).toBe('8800.00');
  });

  it('explains every access: applied, found but not used, not found', () => {
    const unit = record('ZP02', 'B2B_UNIT', '179.00');
    const soldTo = record('ZP02', 'SOLD_TO', '189.50');
    const base = document([
      { candidates: [unit, soldTo, record('ZP01', 'SALES_AREA', '199.00')] },
    ]).items[0].lines[1];
    expect(
      base.kind === 'CONDITION' &&
        base.accesses.map((a) => [a.accessNumber, a.result]),
    ).toEqual([
      [10, 'NOT_FOUND'],
      [20, 'APPLIED'],
      [30, 'NOT_FOUND'],
      [40, 'FOUND_NOT_USED'],
      [50, 'FOUND_NOT_USED'],
    ]);
  });

  it('marks an item without a mandatory price as incomplete and prices the others', () => {
    const result = document([
      { candidates: [record('ZP01', 'SALES_AREA', '10.00')] },
      // Only an expired and an inactive record: no price
      {
        candidates: [
          record('ZP01', 'SALES_AREA', '5.00', { validTo: '2026-11-09' }),
          record('ZP02', 'SOLD_TO', '4.00', { isActive: false }),
        ],
      },
    ]);
    expect(result.status).toBe('INCOMPLETE');
    expect(result.netValue).toBeNull();
    expect(result.items.map((i) => i.status)).toEqual(['PRICED', 'INCOMPLETE']);
    expect(result.items[1].netValue).toBeNull();
    expect(result.items[1].lines[2]).toMatchObject({
      kind: 'SUBTOTAL',
      value: null,
    });
    expect(result.messages).toEqual([
      {
        code: 'MANDATORY_CONDITION_MISSING',
        itemNumber: 20,
        step: 10,
        text: 'No valid record for the mandatory step 10 "Base price" of material MAT-2 on 2026-11-10',
      },
    ]);
  });

  it('calculates in the document currency: JPY without decimals', () => {
    const result = document(
      [
        {
          candidates: [
            record('ZP01', 'SALES_AREA', '700000', {
              salesArea: JAPAN,
              currency: 'JPY',
            }),
          ],
          quantity: 3,
        },
      ],
      {
        salesArea: JAPAN,
        currency: JPY,
        procedure: { ...ZDE001, code: 'ZJP001' },
      },
    );
    expect(result.netValue?.toString()).toBe('2100000');
    expect(() =>
      document(
        [
          {
            candidates: [
              record('ZP01', 'SALES_AREA', '1.50', {
                salesArea: JAPAN,
                currency: 'JPY',
              }),
            ],
          },
        ],
        {
          salesArea: JAPAN,
          currency: JPY,
        },
      ),
    ).toThrow('more decimal places than JPY allows');
  });

  it('refuses records of another sales area or currency (no conversion)', () => {
    expect(() =>
      document([
        {
          candidates: [
            record('ZP01', 'SALES_AREA', '1.00', { salesArea: JAPAN }),
          ],
        },
      ]),
    ).toThrow('belongs to sales area 3000/10/00');
    expect(() =>
      document([
        {
          candidates: [
            record('ZP01', 'SALES_AREA', '1.00', { currency: 'PLN' }),
          ],
        },
      ]),
    ).toThrow('uses PLN');
  });

  it('refuses configurations that Sprint 13A cannot calculate', () => {
    const withStep = (step: Partial<ProcedureStepDefinition>) => ({
      ...ZDE001,
      steps: [conditionStep(step), ZDE001.steps[2]],
    });
    expect(() => assertCalculable(withStep({ accesses: [] }))).toThrow(
      'has no accesses',
    );
    expect(() =>
      assertCalculable(
        withStep({
          accesses: [
            {
              ...access(10, 'ZD01', 'SOLD_TO'),
              conditionType: type('ZD01', {
                conditionClass: 'DISCOUNT_SURCHARGE',
                calculationType: 'PERCENTAGE',
              }),
            },
          ],
        }),
      ),
    ).toThrow('ZD01 cannot be calculated yet');
    expect(() =>
      assertCalculable(
        withStep({
          accesses: [
            { ...access(10, 'ZP02', 'SOLD_TO'), materialSpecific: false },
          ],
        }),
      ),
    ).toThrow('material-independent');
    expect(() =>
      assertCalculable({ ...ZDE001, steps: [conditionStep({})] }),
    ).toThrow('exactly one NET_VALUE');
    expect(() =>
      assertCalculable({
        ...ZDE001,
        steps: [ZDE001.steps[1], ZDE001.steps[0], ZDE001.steps[2]],
      }),
    ).toThrow('ascending order');
  });
});
