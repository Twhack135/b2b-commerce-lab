import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createJapanData,
  createMuellerData,
  createPolandData,
  createTestApp,
  GERMANY,
  JAPAN,
  POLAND,
  resetDatabase,
  tableFingerprint,
} from './helpers';

// Sprint 13A-3: POST /pricing/calculate prices a document with the pricing
// procedure of its sales area. It runs next to the released price
// determination; for every case below it must give exactly the base price
// of POST /pricing/price and the net value of the order simulation.

type Line = {
  step: number;
  kind: string;
  conditionId: number | null;
  scope: string | null;
  rate: string | null;
  value: string | null;
  statistical: boolean;
  conditionType: { code: string } | null;
  accesses?: { accessNumber: number; result: string }[];
};
type Item = {
  itemNumber: number;
  status: string;
  netValue: string | null;
  lines: Line[];
  messages: unknown[];
};
type Document = {
  status: string;
  procedure: { code: string; revision: number };
  currency: { code: string; decimals: number };
  items: Item[];
  totals: { netValue: string | null };
  messages: { code: string; itemNumber: number; step: number; text: string }[];
};

describe('Document pricing POST /pricing/calculate (Sprint 13A)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMuellerData(prisma);
    await createPolandData(prisma);
    await createJapanData(prisma);
    // A special price of the Sold-to for the heat pump (as #4 of b2b_erp)
    await prisma.priceCondition.create({
      data: {
        conditionTypeCode: 'ZP03',
        ...GERMANY,
        materialNumber: 'MAT-001',
        scope: 'SOLD_TO',
        soldToCustomerNumber: 'CUST-1000',
        amount: '4400.00',
        currency: 'EUR',
        validFrom: new Date('2026-10-29T00:00:00Z'),
      },
    });
  });

  const calculate = (body: object) =>
    http().post('/pricing/calculate').send(body);
  const base = (item: Item) => item.lines.find((l) => l.step === 10)!;

  it('gives the base price of POST /pricing/price for every unit, material and date', async () => {
    const cases: [typeof GERMANY, string, string][] = [];
    for (const unitId of ['UNIT-STUTTGART', 'UNIT-MUENCHEN']) {
      for (const materialNumber of ['MAT-001', 'MAT-002', 'MAT-PL']) {
        for (const date of [
          '2025-12-31',
          '2026-01-01',
          '2026-06-14',
          '2026-06-15',
          '2026-10-28',
          '2026-10-29',
          '2026-11-15',
        ]) {
          cases.push([GERMANY, `${unitId}|${materialNumber}`, date]);
        }
      }
    }
    for (const materialNumber of ['MAT-001', 'MAT-PL']) {
      cases.push([POLAND, `UNIT-WARSZAWA|${materialNumber}`, '2026-11-15']);
      cases.push([JAPAN, `UNIT-OSAKA|${materialNumber}`, '2026-11-15']);
    }
    let priced = 0;
    for (const [area, key, pricingDate] of cases) {
      const [unitId, materialNumber] = key.split('|');
      const price = await http()
        .post('/pricing/price')
        .send({ ...area, unitId, materialNumber, pricingDate, quantity: 3 });
      const document = await calculate({
        ...area,
        unitId,
        pricingDate,
        items: [{ materialNumber, quantity: 3 }],
      }).expect(200);
      const result = document.body as Document;
      const line = base(result.items[0]);
      const label = `${key} ${pricingDate}`;
      if (price.status === 200) {
        priced += 1;
        expect([
          label,
          result.status,
          line.conditionId,
          line.scope,
          line.rate,
          line.value,
          result.items[0].netValue,
        ]).toEqual([
          label,
          'COMPLETE',
          price.body.conditionId,
          price.body.source,
          price.body.unitPrice,
          price.body.netValue,
          price.body.netValue,
        ]);
        expect(line.conditionType?.code).toBe(price.body.conditionType.code);
        expect(result.currency.code).toBe(price.body.currency);
      } else {
        expect([label, price.status, price.body.code]).toEqual([
          label,
          422,
          'NO_PRICE_FOUND',
        ]);
        expect([
          label,
          result.status,
          line.conditionId,
          result.items[0].netValue,
        ]).toEqual([label, 'INCOMPLETE', null, null]);
      }
    }
    // The matrix covers prices of every level and missing prices
    expect(priced).toBeGreaterThan(20);
    expect(priced).toBeLessThan(cases.length);
  });

  it('gives the net value of the order simulation for the Müller order', async () => {
    const order = {
      ...GERMANY,
      unitId: 'UNIT-STUTTGART',
      pricingDate: '2026-11-15',
      items: [
        { materialNumber: 'MAT-001', quantity: 2 },
        { materialNumber: 'MAT-002', quantity: 10 },
      ],
    };
    const simulation = (
      await http().post('/sales-orders/simulate').send(order).expect(200)
    ).body;
    const result = (await calculate(order).expect(200)).body as Document;
    expect(result.totals.netValue).toBe(simulation.totals.netValue);
    expect(result.items.map((i) => i.netValue)).toEqual(
      simulation.items.map((i: { netValue: string }) => i.netValue),
    );
    // 2 x 4400.00 (ZP03 special price) + 10 x 189.50 (ZP02 of the Sold-to)
    expect(result.totals.netValue).toBe('10695.00');
  });

  it('explains the result: procedure, statistical list price, accesses, subtotal', async () => {
    const result = (
      await calculate({
        ...GERMANY,
        unitId: 'UNIT-STUTTGART',
        pricingDate: '2026-11-15',
        items: [{ materialNumber: 'MAT-001', quantity: 2 }],
      }).expect(200)
    ).body as Document;
    expect(result.procedure).toEqual({
      code: 'ZDE001',
      name: 'B2B Germany',
      revision: 1,
    });
    expect(result.currency).toEqual({ code: 'EUR', decimals: 2 });
    const [list, price, net] = result.items[0].lines;
    expect(list).toMatchObject({
      step: 5,
      statistical: true,
      rate: '4500.00',
      value: '9000.00',
      conditionType: { code: 'ZP01' },
    });
    expect(price).toMatchObject({
      step: 10,
      statistical: false,
      rate: '4400.00',
      value: '8800.00',
      scope: 'SOLD_TO',
      conditionType: { code: 'ZP03' },
    });
    expect(price.accesses?.map((a) => [a.accessNumber, a.result])).toEqual([
      [10, 'NOT_FOUND'],
      [20, 'NOT_FOUND'],
      [30, 'APPLIED'],
      [40, 'NOT_FOUND'],
      [50, 'FOUND_NOT_USED'],
    ]);
    expect(net).toMatchObject({
      step: 100,
      kind: 'SUBTOTAL',
      key: 'NET_VALUE',
      value: '8800.00',
    });
    expect(Object.keys(result).sort()).toEqual([
      'currency',
      'items',
      'messages',
      'pricingDate',
      'procedure',
      'salesArea',
      'soldToCustomerNumber',
      'status',
      'totals',
      'unitId',
    ]);
  });

  it('answers 200 INCOMPLETE with a message per item when a mandatory price is missing', async () => {
    const result = (
      await calculate({
        ...POLAND,
        unitId: 'UNIT-WARSZAWA',
        pricingDate: '2026-11-15',
        items: [
          { materialNumber: 'MAT-PL', quantity: 4 },
          { materialNumber: 'MAT-001', quantity: 1 },
        ],
      }).expect(200)
    ).body as Document;
    expect(result.procedure.code).toBe('ZPL001');
    expect(result.status).toBe('INCOMPLETE');
    expect(
      result.items.map((i) => [i.itemNumber, i.status, i.netValue]),
    ).toEqual([
      [10, 'PRICED', '396.00'],
      [20, 'INCOMPLETE', null],
    ]);
    expect(result.totals.netValue).toBeNull();
    expect(result.messages).toEqual([
      {
        code: 'MANDATORY_CONDITION_MISSING',
        itemNumber: 20,
        step: 10,
        text: 'No valid record for the mandatory step 10 "Base price" of material MAT-001 on 2026-11-15',
      },
    ]);
  });

  it('calculates JPY without decimals with ZJP001', async () => {
    const result = (
      await calculate({
        ...JAPAN,
        unitId: 'UNIT-OSAKA',
        pricingDate: '2026-11-15',
        items: [{ materialNumber: 'MAT-001', quantity: 3 }],
      }).expect(200)
    ).body as Document;
    expect(result.procedure.code).toBe('ZJP001');
    expect(result.currency).toEqual({ code: 'JPY', decimals: 0 });
    expect(result.totals.netValue).toBe('2100000');
    expect(base(result.items[0]).rate).toBe('700000');
  });

  it('ignores inactive records like the price determination', async () => {
    await prisma.priceCondition.updateMany({
      where: { conditionTypeCode: 'ZP03' },
      data: { isActive: false },
    });
    const result = (
      await calculate({
        ...GERMANY,
        unitId: 'UNIT-STUTTGART',
        pricingDate: '2026-11-15',
        items: [{ materialNumber: 'MAT-001', quantity: 1 }],
      }).expect(200)
    ).body as Document;
    expect(base(result.items[0])).toMatchObject({
      conditionType: { code: 'ZP01' },
      rate: '4500.00',
    });
  });

  it('refuses the same units and sales areas as POST /pricing/price, with the same messages', async () => {
    const refusals: object[] = [
      { ...GERMANY, unitId: 'UNIT-NOPE' },
      { ...POLAND, unitId: 'UNIT-STUTTGART' },
      { ...GERMANY, salesOrganization: '9999', unitId: 'UNIT-STUTTGART' },
    ];
    for (const refusal of refusals) {
      const price = await http()
        .post('/pricing/price')
        .send({
          ...refusal,
          materialNumber: 'MAT-001',
          pricingDate: '2026-11-15',
        })
        .expect(422);
      const document = await calculate({
        ...refusal,
        pricingDate: '2026-11-15',
        items: [{ materialNumber: 'MAT-001', quantity: 1 }],
      }).expect(422);
      expect(document.body.message).toEqual(price.body.message);
    }
    await prisma.b2bUnit.update({
      where: { unitId: 'UNIT-STUTTGART' },
      data: { isActive: false },
    });
    const inactive = await calculate({
      ...GERMANY,
      unitId: 'UNIT-STUTTGART',
      pricingDate: '2026-11-15',
      items: [{ materialNumber: 'MAT-001', quantity: 1 }],
    }).expect(422);
    expect(inactive.body.message).toEqual([
      'unitId UNIT-STUTTGART is inactive',
    ]);
    const unknown = await calculate({
      ...JAPAN,
      unitId: 'UNIT-OSAKA',
      pricingDate: '2026-11-15',
      items: [{ materialNumber: 'MAT-NOPE', quantity: 1 }],
    }).expect(422);
    expect(unknown.body.message).toEqual([
      'materialNumber MAT-NOPE does not exist',
    ]);
  });

  it('refuses a sales area without an active pricing procedure', async () => {
    await prisma.pricingProcedure.update({
      where: { code: 'ZPL001' },
      data: { isActive: false },
    });
    try {
      const response = await calculate({
        ...POLAND,
        unitId: 'UNIT-WARSZAWA',
        pricingDate: '2026-11-15',
        items: [{ materialNumber: 'MAT-PL', quantity: 1 }],
      }).expect(422);
      expect(response.body.message).toEqual([
        'No pricing procedure is determined for sales area 2000/10/00',
      ]);
    } finally {
      // Configuration of the migration: always restored
      await prisma.pricingProcedure.update({
        where: { code: 'ZPL001' },
        data: { isActive: true },
      });
    }
  });

  it('validates the request like the order simulation', async () => {
    const valid = {
      ...GERMANY,
      unitId: 'UNIT-STUTTGART',
      pricingDate: '2026-11-15',
      items: [{ materialNumber: 'MAT-001', quantity: 1 }],
    };
    for (const body of [
      { ...valid, items: [] },
      { ...valid, items: [{ materialNumber: 'MAT-001', quantity: 0 }] },
      { ...valid, items: [{ materialNumber: 'MAT-001', quantity: 100000 }] },
      { ...valid, items: [{ materialNumber: 'MAT-001', quantity: 1.5 }] },
      {
        ...valid,
        items: Array.from({ length: 201 }, () => ({
          materialNumber: 'MAT-001',
          quantity: 1,
        })),
      },
      { ...valid, pricingDate: '2026-02-30' },
      { ...valid, unitPrice: '1.00' },
      {
        ...valid,
        items: [{ materialNumber: 'MAT-001', quantity: 1, price: '1.00' }],
      },
    ]) {
      await calculate(body).expect(400);
    }
  });

  it('stores nothing', async () => {
    const before = await tableFingerprint(prisma);
    await calculate({
      ...GERMANY,
      unitId: 'UNIT-STUTTGART',
      pricingDate: '2026-11-15',
      items: [{ materialNumber: 'MAT-001', quantity: 2 }],
    }).expect(200);
    expect(await tableFingerprint(prisma)).toEqual(before);
    expect(await prisma.salesOrder.count()).toBe(0);
  });
});
