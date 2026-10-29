import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createPricingData, createTestApp, resetDatabase } from './helpers';

type Result = {
  source: string;
  conditionId: number | null;
  unitPrice: string;
  netValue: string;
  steps: { source: string; conditionId: number | null; applied: boolean }[];
};

describe('Pricing API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];

  // Condition IDs created in beforeEach
  let soldToId: number;
  let unitId: number;

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  const createCondition = async (body: object) => {
    const response = await http()
      .post('/price-conditions')
      .send({ materialNumber: 'MAT-1', currency: 'EUR', ...body })
      .expect(201);
    return (response.body as { conditionId: number }).conditionId;
  };

  // Timeline for MAT-1 and unit U1 (Sold-to ACC):
  //   until 2025-12-31          base price 4500.00
  //   2026-01-01 .. 2026-12-31  Sold-to price 4350.00
  //   2026-07-01 .. open        unit price 4200.00 (wins from July)
  //   2027-01-01 .. open        another, inactive Sold-to price
  beforeEach(async () => {
    await resetDatabase(prisma);
    await createPricingData(prisma);
    soldToId = await createCondition({
      scope: 'SOLD_TO',
      soldToCustomerNumber: 'ACC',
      amount: '4350.00',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
    });
    unitId = await createCondition({
      scope: 'B2B_UNIT',
      unitId: 'U1',
      amount: '4200.00',
      validFrom: '2026-07-01',
    });
    await createCondition({
      scope: 'SOLD_TO',
      soldToCustomerNumber: 'ACC',
      amount: '1.00',
      validFrom: '2027-01-01',
      isActive: false,
    });
  });

  const price = (body: object) =>
    http()
      .post('/pricing/price')
      .send({ materialNumber: 'MAT-1', unitId: 'U1', ...body });

  const resultOn = async (pricingDate: string) => {
    const { body } = await price({ pricingDate }).expect(200);
    return body as Result;
  };

  it.each([
    ['2025-12-31', 'BASE_PRICE', '4500.00'],
    ['2026-01-01', 'SOLD_TO', '4350.00'],
    ['2026-06-30', 'SOLD_TO', '4350.00'],
    ['2026-07-01', 'B2B_UNIT', '4200.00'],
    ['2026-12-31', 'B2B_UNIT', '4200.00'],
    ['2030-01-01', 'B2B_UNIT', '4200.00'],
  ])('on %s uses %s (%s)', async (pricingDate, source, unitPrice) => {
    await expect(resultOn(pricingDate)).resolves.toMatchObject({
      source,
      unitPrice,
    });
  });

  it('returns the complete result with all steps', async () => {
    const { body } = await price({
      pricingDate: '2026-11-15',
      quantity: 3,
    }).expect(200);

    expect(body).toEqual({
      materialNumber: 'MAT-1',
      materialDescription: 'Heat Pump',
      unitId: 'U1',
      soldToCustomerNumber: 'ACC',
      pricingDate: '2026-11-15',
      quantity: 3,
      unitPrice: '4200.00',
      netValue: '12600.00',
      currency: 'EUR',
      source: 'B2B_UNIT',
      conditionId: unitId,
      validFrom: '2026-07-01',
      validTo: null,
      steps: [
        {
          source: 'B2B_UNIT',
          conditionId: unitId,
          amount: '4200.00',
          applied: true,
        },
        {
          source: 'SOLD_TO',
          conditionId: soldToId,
          amount: '4350.00',
          applied: false,
        },
        {
          source: 'BASE_PRICE',
          conditionId: null,
          amount: '4500.00',
          applied: false,
        },
      ],
    });
  });

  it('ignores inactive conditions', async () => {
    await http()
      .patch(`/price-conditions/${unitId}`)
      .send({ isActive: false })
      .expect(200);

    await expect(resultOn('2027-06-01')).resolves.toMatchObject({
      source: 'BASE_PRICE',
      unitPrice: '4500.00',
    });
  });

  it('does not use prices of another unit or Sold-to', async () => {
    await createCondition({
      scope: 'SOLD_TO',
      soldToCustomerNumber: 'M1',
      amount: '10.00',
      validFrom: '2020-01-01',
    });

    await expect(resultOn('2025-06-01')).resolves.toMatchObject({
      source: 'BASE_PRICE',
    });
  });

  it('calculates exact values for small amounts and large quantities', async () => {
    await createCondition({
      materialNumber: 'MAT-2',
      currency: 'CHF',
      scope: 'B2B_UNIT',
      unitId: 'U1',
      amount: '0.10',
      validFrom: '2026-01-01',
    });

    const { body } = await http()
      .post('/pricing/price')
      .send({
        materialNumber: 'MAT-2',
        unitId: 'U1',
        pricingDate: '2026-01-01',
        quantity: 99999,
      })
      .expect(200);

    expect(body).toMatchObject({
      unitPrice: '0.10',
      netValue: '9999.90',
      currency: 'CHF',
    });
  });

  it('uses the current base price as fallback', async () => {
    await http().patch('/materials/MAT-1').send({ price: 4599.99 }).expect(200);

    await expect(resultOn('2025-01-01')).resolves.toMatchObject({
      unitPrice: '4599.99',
    });
  });

  it.each([
    [
      'an unknown material and unit',
      { materialNumber: 'NOPE', unitId: 'NOPE' },
      ['materialNumber NOPE does not exist', 'unitId NOPE does not exist'],
    ],
    ['an inactive unit', { unitId: 'U-OFF' }, ['unitId U-OFF is inactive']],
    [
      'a unit with an inactive Sold-to',
      { unitId: 'U-OLD' },
      ['unitId U-OLD has an inactive Sold-to OLD'],
    ],
  ])('answers 422 for %s', async (_case, change, messages) => {
    const response = await price({
      pricingDate: '2026-11-15',
      ...change,
    }).expect(422);
    expect((response.body as { message: string[] }).message).toEqual(messages);
  });

  it.each([
    ['a missing pricing date', {}],
    ['an invalid pricing date', { pricingDate: '2026-13-01' }],
    ['quantity 0', { pricingDate: '2026-11-15', quantity: 0 }],
    ['a fractional quantity', { pricingDate: '2026-11-15', quantity: 0.5 }],
  ])('answers 400 for %s', async (_case, body) => {
    await price(body).expect(400);
  });

  it('only accepts POST', async () => {
    await http().get('/pricing/price').expect(404);
  });
});
