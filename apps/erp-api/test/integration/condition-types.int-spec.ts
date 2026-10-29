// Condition types: the configuration created by the migration, the database
// rules, the read-only API and the condition type metadata in the pricing
// responses. Prices and their precedence must not change.
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createMuellerData, createTestApp, resetDatabase } from './helpers';

type Summary = {
  code: string;
  name: string;
  conditionClass: string;
  calculationType: string;
};
type Step = { source: string; conditionType: Summary | null };

const summary = (code: string, name: string): Summary => ({
  code,
  name,
  conditionClass: 'PRICE',
  calculationType: 'QUANTITY',
});
const ZP01 = summary('ZP01', 'List Price');
const ZP02 = summary('ZP02', 'Customer Net Price');
const ZP03 = summary('ZP03', 'Special Price');

/** The PostgreSQL error code of a failed statement, or 'ok' */
async function codeOf(statement: Promise<unknown>) {
  const error = await statement.then(
    () => null,
    (e: unknown) => e,
  );
  if (error === null) return 'ok';
  const meta = (error as { meta?: Record<string, unknown> }).meta;
  const adapterError = meta?.driverAdapterError as
    { cause?: { originalCode?: string } } | undefined;
  return adapterError?.cause?.originalCode ?? (error as Error).message;
}

describe('Condition types', () => {
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
    // Tests may change the configuration; restore the migration values
    await prisma.conditionType.updateMany({
      data: { isActive: true, allowedForConditionRecords: false },
    });
    await prisma.conditionType.updateMany({
      where: { code: { in: ['ZP02', 'ZP03'] } },
      data: { allowedForConditionRecords: true },
    });
  });

  const condition = (body: object) =>
    http()
      .post('/price-conditions')
      .send({
        conditionTypeCode: 'ZP03',
        materialNumber: 'MAT-001',
        scope: 'SOLD_TO',
        soldToCustomerNumber: 'CUST-1000',
        amount: '4100.00',
        currency: 'EUR',
        validFrom: '2026-01-01',
        ...body,
      });

  describe('configuration from the migration', () => {
    it('lists the six initial condition types in display order', async () => {
      const { body } = await http().get('/condition-types').expect(200);

      const config = (
        allowedForConditionRecords: boolean,
        restriction: string | null,
        sortOrder: number,
      ) => ({
        isActive: true,
        sortOrder,
        allowedForConditionRecords,
        usableForPriceConditions: restriction === null,
        restriction,
      });
      expect(body).toEqual([
        { ...ZP01, ...config(false, 'NOT_ALLOWED_FOR_CONDITION_RECORDS', 10) },
        { ...ZP02, ...config(true, null, 20) },
        { ...ZP03, ...config(true, null, 30) },
        {
          code: 'ZD01',
          name: 'Customer Discount',
          conditionClass: 'DISCOUNT_SURCHARGE',
          calculationType: 'PERCENTAGE',
          ...config(false, 'CALCULATION_NOT_SUPPORTED', 40),
        },
        {
          code: 'ZF01',
          name: 'Freight',
          conditionClass: 'FREIGHT',
          calculationType: 'FIXED_AMOUNT',
          ...config(false, 'CALCULATION_NOT_SUPPORTED', 50),
        },
        {
          code: 'ZT01',
          name: 'Output Tax',
          conditionClass: 'TAX',
          calculationType: 'PERCENTAGE',
          ...config(false, 'CALCULATION_NOT_SUPPORTED', 60),
        },
      ]);
    });

    it('reports an inactive type as not usable', async () => {
      await prisma.conditionType.update({
        where: { code: 'ZP03' },
        data: { isActive: false },
      });

      const { body } = await http().get('/condition-types').expect(200);

      expect(
        (body as { code: string; usableForPriceConditions: boolean }[]).find(
          (t) => t.code === 'ZP03',
        ),
      ).toMatchObject({ isActive: false, usableForPriceConditions: false });
    });

    it('is read-only', async () => {
      await http().post('/condition-types').send({}).expect(404);
      await http().patch('/condition-types/ZP02').send({}).expect(404);
      await http().delete('/condition-types/ZP02').expect(404);
    });
  });

  describe('database rules', () => {
    it.each([
      ['a lowercase code', 'zp09', 'Test'],
      ['a code with 3 characters', 'ZP9', 'Test'],
      ['a blank name', 'ZP09', '   '],
    ])('rejects %s', async (_case, code, name) => {
      await expect(
        codeOf(prisma.$executeRaw`
          INSERT INTO condition_types (code, name, condition_class, calculation_type, sort_order, updated_at)
          VALUES (${code}, ${name}, 'PRICE', 'QUANTITY', 99, now())`),
      ).resolves.toBe('23514');
    });

    it('rejects a condition record with an unknown condition type', async () => {
      await expect(
        codeOf(prisma.$executeRaw`
          INSERT INTO price_conditions (condition_type_code, material_number, scope,
            sold_to_customer_number, amount, currency, valid_from, updated_at)
          VALUES ('ZZ99', 'MAT-001', 'SOLD_TO', 'CUST-1000', 1, 'EUR', '2026-01-01', now())`),
      ).resolves.toBe('23503');
    });

    it('rejects a condition record without a condition type', async () => {
      await expect(
        codeOf(prisma.$executeRaw`
          INSERT INTO price_conditions (material_number, scope,
            sold_to_customer_number, amount, currency, valid_from, updated_at)
          VALUES ('MAT-001', 'SOLD_TO', 'CUST-1000', 1, 'EUR', '2026-01-01', now())`),
      ).resolves.toBe('23502');
    });

    it('prevents deleting a condition type that is in use', async () => {
      await expect(
        codeOf(
          prisma.$executeRaw`DELETE FROM condition_types WHERE code = 'ZP02'`,
        ),
      ).resolves.toBe('23001');
    });
  });

  describe('condition records', () => {
    it('can use ZP03 on the Sold-to and on the unit level', async () => {
      const soldTo = await condition({}).expect(201);
      const unit = await condition({
        scope: 'B2B_UNIT',
        soldToCustomerNumber: undefined,
        unitId: 'UNIT-STUTTGART',
      }).expect(201);

      expect(soldTo.body).toMatchObject({
        conditionType: ZP03,
        scope: 'SOLD_TO',
      });
      expect(unit.body).toMatchObject({
        conditionType: ZP03,
        scope: 'B2B_UNIT',
      });
    });

    it('shows the backfilled type of existing records', async () => {
      const { body } = await http().get('/price-conditions').expect(200);

      expect(
        (body as { conditionType: Summary; amount: string }[]).map(
          (c) => `${c.conditionType.code} ${c.amount}`,
        ),
      ).toEqual(['ZP02 179.00', 'ZP02 189.50']);
    });

    it('requires a condition type for new records', async () => {
      await condition({ conditionTypeCode: undefined }).expect(400);
    });

    it('rejects ZP01, which is not allowed for condition records, with 422', async () => {
      const response = await condition({ conditionTypeCode: 'ZP01' }).expect(
        422,
      );

      expect((response.body as { message: string[] }).message).toEqual([
        'conditionTypeCode ZP01 (List Price) is not allowed for condition records by its configuration',
      ]);
    });

    it('follows the configuration, not a fixed rule in the code', async () => {
      // Allowing ZP01 in the configuration makes it usable at once ...
      await prisma.conditionType.update({
        where: { code: 'ZP01' },
        data: { allowedForConditionRecords: true },
      });
      await condition({ conditionTypeCode: 'ZP01' }).expect(201);

      // ... and disallowing ZP03 blocks it
      await prisma.conditionType.update({
        where: { code: 'ZP03' },
        data: { allowedForConditionRecords: false },
      });
      await condition({
        materialNumber: 'MAT-002',
        validFrom: '2030-01-01',
      }).expect(422);
    });

    it('never allows a type the engine cannot calculate, even if configured', async () => {
      await prisma.conditionType.update({
        where: { code: 'ZD01' },
        data: { allowedForConditionRecords: true },
      });

      const response = await condition({ conditionTypeCode: 'ZD01' }).expect(
        422,
      );
      expect((response.body as { message: string[] }).message[0]).toMatch(
        /cannot be used for price conditions yet/,
      );
    });

    it.each([
      ['ZD01', 'Customer Discount'],
      ['ZF01', 'Freight'],
      ['ZT01', 'Output Tax'],
    ])('rejects %s (%s) for price conditions with 422', async (code, name) => {
      const response = await condition({ conditionTypeCode: code }).expect(422);

      expect((response.body as { message: string[] }).message).toEqual([
        expect.stringMatching(
          new RegExp(
            `^conditionTypeCode ${code} \\(${name}\\) cannot be used for price conditions yet`,
          ),
        ),
      ]);
    });

    it('rejects an unknown and an inactive condition type with 422', async () => {
      const unknown = await condition({ conditionTypeCode: 'ZZ99' }).expect(
        422,
      );
      expect((unknown.body as { message: string[] }).message).toEqual([
        'conditionTypeCode ZZ99 does not exist',
      ]);

      await prisma.conditionType.update({
        where: { code: 'ZP03' },
        data: { isActive: false },
      });
      const inactive = await condition({}).expect(422);
      expect((inactive.body as { message: string[] }).message).toEqual([
        'conditionTypeCode ZP03 (Special Price) is inactive',
      ]);
    });

    it('does not allow changing the condition type', async () => {
      await http()
        .patch('/price-conditions/1')
        .send({ conditionTypeCode: 'ZP03' })
        .expect(400);
    });

    it('checks the condition type again when a record is reactivated', async () => {
      const { body } = await condition({}).expect(201);
      const id = (body as { conditionId: number }).conditionId;
      await http()
        .patch(`/price-conditions/${id}`)
        .send({ isActive: false })
        .expect(200);
      await prisma.conditionType.update({
        where: { code: 'ZP03' },
        data: { isActive: false },
      });

      // Editing an inactive record is possible, reactivating it is not
      await http()
        .patch(`/price-conditions/${id}`)
        .send({ amount: '4000.00' })
        .expect(200);
      const response = await http()
        .patch(`/price-conditions/${id}`)
        .send({ isActive: true })
        .expect(422);
      expect((response.body as { message: string[] }).message).toEqual([
        'conditionTypeCode ZP03 (Special Price) is inactive',
      ]);
    });
  });

  describe('pricing analysis', () => {
    it('adds condition types to the price check without changing prices', async () => {
      const { body } = await http()
        .post('/pricing/price')
        .send({
          materialNumber: 'MAT-002',
          unitId: 'UNIT-MUENCHEN',
          pricingDate: '2026-11-15',
        })
        .expect(200);
      const result = body as {
        unitPrice: string;
        source: string;
        conditionType: Summary;
        steps: Step[];
      };

      expect(result).toMatchObject({
        unitPrice: '179.00',
        source: 'B2B_UNIT',
        conditionType: ZP02,
      });
      expect(
        result.steps.map((s) => `${s.source}:${s.conditionType?.code ?? '-'}`),
      ).toEqual(['B2B_UNIT:ZP02', 'SOLD_TO:ZP02', 'BASE_PRICE:ZP01']);
    });

    it('shows ZP01 for the material base price', async () => {
      const { body } = await http()
        .post('/pricing/price')
        .send({
          materialNumber: 'MAT-001',
          unitId: 'UNIT-STUTTGART',
          pricingDate: '2026-11-15',
        })
        .expect(200);

      expect(body).toMatchObject({
        unitPrice: '4500.00',
        source: 'BASE_PRICE',
        conditionType: ZP01,
      });
    });

    it('keeps the unit before the Sold-to, whatever the condition types are', async () => {
      // A "special price" for the Sold-to does not beat the unit's net price
      await condition({
        materialNumber: 'MAT-002',
        amount: '150.00',
        validFrom: '2026-01-01',
      }).expect(409);
      await prisma.priceCondition.updateMany({
        where: { scope: 'SOLD_TO' },
        data: { conditionTypeCode: 'ZP03', amount: '150.00' },
      });

      const { body } = await http()
        .post('/pricing/price')
        .send({
          materialNumber: 'MAT-002',
          unitId: 'UNIT-MUENCHEN',
          pricingDate: '2026-11-15',
        })
        .expect(200);

      expect(body).toMatchObject({
        unitPrice: '179.00',
        source: 'B2B_UNIT',
        conditionType: ZP02,
      });
    });

    it('adds condition types to the order simulation, with the same Müller total', async () => {
      const { body } = await http()
        .post('/sales-orders/simulate')
        .send({
          unitId: 'UNIT-STUTTGART',
          pricingDate: '2026-11-15',
          items: [
            { materialNumber: 'MAT-001', quantity: 2 },
            { materialNumber: 'MAT-002', quantity: 10 },
          ],
        })
        .expect(200);
      const result = body as {
        status: string;
        totals: { netValue: string };
        items: {
          netValue: string;
          pricing: { conditionType: Summary; steps: Step[] };
        }[];
      };

      expect(result.status).toBe('VALID');
      expect(result.totals.netValue).toBe('10895.00');
      expect(
        result.items.map(
          (i) => `${i.netValue} ${i.pricing.conditionType.code}`,
        ),
      ).toEqual(['9000.00 ZP01', '1895.00 ZP02']);
      expect(
        result.items[1].pricing.steps.map((s) => s.conditionType?.code ?? null),
      ).toEqual([null, 'ZP02', 'ZP01']);
    });
  });
});
