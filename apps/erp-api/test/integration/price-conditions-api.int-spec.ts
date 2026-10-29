import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createPricingData, createTestApp, resetDatabase } from './helpers';

const ZP02 = {
  code: 'ZP02',
  name: 'Customer Net Price',
  conditionClass: 'PRICE',
  calculationType: 'QUANTITY',
};

const soldToBody = {
  conditionTypeCode: 'ZP02',
  materialNumber: 'MAT-1',
  scope: 'SOLD_TO',
  soldToCustomerNumber: 'ACC',
  amount: '4350.00',
  currency: 'EUR',
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
};

const unitBody = {
  conditionTypeCode: 'ZP02',
  materialNumber: 'MAT-1',
  scope: 'B2B_UNIT',
  unitId: 'U1',
  amount: '4200.00',
  currency: 'EUR',
  validFrom: '2026-01-01',
};

describe('Price conditions API', () => {
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
    await createPricingData(prisma);
  });

  const create = (body: object) => http().post('/price-conditions').send(body);

  describe('POST /price-conditions', () => {
    it('creates a Sold-to condition and returns it with summaries', async () => {
      const response = await create(soldToBody).expect(201);

      expect(response.body).toEqual({
        conditionId: expect.any(Number) as unknown,
        conditionType: ZP02,
        materialNumber: 'MAT-1',
        materialDescription: 'Heat Pump',
        scope: 'SOLD_TO',
        soldTo: {
          customerNumber: 'ACC',
          name: 'Customer ACC',
          isActive: true,
        },
        unit: null,
        amount: '4350.00',
        currency: 'EUR',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        isActive: true,
      });
    });

    it('creates an open-ended unit condition with its Sold-to', async () => {
      const response = await create(unitBody).expect(201);

      expect(response.body).toMatchObject({
        scope: 'B2B_UNIT',
        soldTo: null,
        unit: {
          unitId: 'U1',
          name: 'Unit U1',
          isActive: true,
          soldTo: { customerNumber: 'ACC', isActive: true },
        },
        validTo: null,
      });
    });

    it('stores the exact amount', async () => {
      const { body } = await create({ ...soldToBody, amount: '0.1' }).expect(
        201,
      );
      expect((body as { amount: string }).amount).toBe('0.10');
      const stored = await prisma.priceCondition.findFirstOrThrow();
      expect(stored.amount.toFixed(2)).toBe('0.10');
    });

    it('allows a directly following period', async () => {
      await create(soldToBody).expect(201);
      await create({
        ...soldToBody,
        validFrom: '2027-01-01',
        validTo: null,
      }).expect(201);
    });

    it('answers 409 with the conflicting condition for an overlap', async () => {
      const first = await create(soldToBody).expect(201);
      const id = (first.body as { conditionId: number }).conditionId;

      const response = await create({
        ...soldToBody,
        validFrom: '2026-12-31',
        validTo: null,
      }).expect(409);

      expect(response.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: `The validity period overlaps with active price condition ${id} (2026-01-01 to 2026-12-31)`,
        conflictingConditionId: id,
      });
      await expect(prisma.priceCondition.count()).resolves.toBe(1);
    });

    it('allows an inactive condition for an overlapping period', async () => {
      await create(soldToBody).expect(201);
      await create({ ...soldToBody, isActive: false }).expect(201);
    });

    it.each([
      [
        'an unknown material',
        { materialNumber: 'NOPE' },
        'materialNumber NOPE does not exist',
      ],
      [
        'another currency',
        { currency: 'CHF' },
        'currency must be EUR, the currency of material MAT-1',
      ],
      [
        'an unknown Sold-to',
        { soldToCustomerNumber: 'NOPE' },
        'soldToCustomerNumber NOPE does not exist',
      ],
      [
        'an inactive Sold-to',
        { soldToCustomerNumber: 'OLD' },
        'soldToCustomerNumber OLD is inactive',
      ],
      [
        'an end before the start',
        { validFrom: '2026-12-31', validTo: '2026-01-01' },
        'validTo must not be before validFrom',
      ],
    ])('answers 422 for %s', async (_case, change, message) => {
      const response = await create({ ...soldToBody, ...change }).expect(422);
      expect((response.body as { message: string[] }).message).toEqual([
        message,
      ]);
    });

    it.each([
      ['an unknown unit', 'NOPE', ['unitId NOPE does not exist']],
      ['an inactive unit', 'U-OFF', ['unitId U-OFF is inactive']],
      [
        'a unit with an inactive Sold-to',
        'U-OLD',
        ['unitId U-OLD has an inactive Sold-to OLD'],
      ],
    ])('answers 422 for %s', async (_case, unitId, messages) => {
      const response = await create({ ...unitBody, unitId }).expect(422);
      expect((response.body as { message: string[] }).message).toEqual(
        messages,
      );
    });

    it.each([
      ['an amount as number', { amount: 4350 }],
      ['three decimals', { amount: '1.999' }],
      ['an amount of zero', { amount: '0.00' }],
      ['an impossible date', { validFrom: '2026-02-30' }],
      ['a unit for a Sold-to condition', { unitId: 'U1' }],
      ['an unknown property', { priceUnit: 100 }],
    ])('answers 400 for %s', async (_case, change) => {
      await create({ ...soldToBody, ...change }).expect(400);
      await expect(prisma.priceCondition.count()).resolves.toBe(0);
    });
  });

  describe('GET /price-conditions', () => {
    it('lists conditions sorted by material, scope, key and start', async () => {
      await create({ ...soldToBody, validFrom: '2027-01-01', validTo: null });
      await create(soldToBody);
      await create(unitBody);
      await create({
        ...soldToBody,
        materialNumber: 'MAT-2',
        currency: 'CHF',
        amount: '180.00',
      });

      const { body } = await http().get('/price-conditions').expect(200);

      expect(
        (
          body as { materialNumber: string; scope: string; validFrom: string }[]
        ).map((c) => `${c.materialNumber} ${c.scope} ${c.validFrom}`),
      ).toEqual([
        'MAT-1 B2B_UNIT 2026-01-01',
        'MAT-1 SOLD_TO 2026-01-01',
        'MAT-1 SOLD_TO 2027-01-01',
        'MAT-2 SOLD_TO 2026-01-01',
      ]);
    });

    it('returns one condition and 404 or 400 for invalid IDs', async () => {
      const { body } = await create(soldToBody).expect(201);
      const id = (body as { conditionId: number }).conditionId;

      await http().get(`/price-conditions/${id}`).expect(200);
      await http().get('/price-conditions/999999').expect(404);
      await http().get('/price-conditions/99999999999').expect(404);
      await http().get('/price-conditions/abc').expect(400);
      await http().get('/price-conditions/1.5').expect(400);
    });

    it('shows units and Sold-tos that became inactive later', async () => {
      await create(unitBody).expect(201);
      await prisma.customer.update({
        where: { customerNumber: 'ACC' },
        data: { isActive: false },
      });

      const { body } = await http().get('/price-conditions').expect(200);
      expect(body).toMatchObject([
        { unit: { unitId: 'U1', soldTo: { isActive: false } } },
      ]);
    });
  });

  describe('PATCH /price-conditions/:conditionId', () => {
    const patch = (id: number, body: object) =>
      http().patch(`/price-conditions/${id}`).send(body);

    let id: number;
    beforeEach(async () => {
      const { body } = await create(soldToBody).expect(201);
      id = (body as { conditionId: number }).conditionId;
    });

    it('changes the amount and the period', async () => {
      const { body } = await patch(id, {
        amount: '4299.99',
        validTo: null,
      }).expect(200);

      expect(body).toMatchObject({
        conditionId: id,
        amount: '4299.99',
        validFrom: '2026-01-01',
        validTo: null,
      });
    });

    it('answers 422 when the new start is after the stored end', async () => {
      const response = await patch(id, { validFrom: '2027-01-01' }).expect(422);
      expect((response.body as { message: string[] }).message).toEqual([
        'validTo must not be before validFrom',
      ]);
    });

    it('answers 409 when an extended period overlaps another condition', async () => {
      await create({
        ...soldToBody,
        validFrom: '2027-01-01',
        validTo: null,
      }).expect(201);

      await patch(id, { validTo: '2027-01-01' }).expect(409);
      await patch(id, { validTo: '2026-12-30' }).expect(200);
    });

    it('deactivates and reactivates with all checks', async () => {
      await patch(id, { isActive: false }).expect(200);
      const second = await create(soldToBody).expect(201);

      // The period is taken now by the second condition
      await patch(id, { isActive: true }).expect(409);

      await patch((second.body as { conditionId: number }).conditionId, {
        isActive: false,
      }).expect(200);
      await prisma.customer.update({
        where: { customerNumber: 'ACC' },
        data: { isActive: false },
      });
      const response = await patch(id, { isActive: true }).expect(422);
      expect((response.body as { message: string[] }).message).toEqual([
        'soldToCustomerNumber ACC is inactive',
      ]);
    });

    it('keeps an active condition editable when its unit became inactive', async () => {
      const { body } = await create(unitBody).expect(201);
      const unitConditionId = (body as { conditionId: number }).conditionId;
      await prisma.b2bUnit.update({
        where: { unitId: 'U1' },
        data: { isActive: false },
      });

      await patch(unitConditionId, { amount: '4100.00' }).expect(200);
      await patch(unitConditionId, { isActive: false }).expect(200);
      const response = await patch(unitConditionId, { isActive: true }).expect(
        422,
      );
      expect((response.body as { message: string[] }).message).toEqual([
        'unitId U1 is inactive',
      ]);
    });

    it.each([
      ['the material', { materialNumber: 'MAT-2' }],
      ['the scope', { scope: 'B2B_UNIT' }],
      ['the Sold-to', { soldToCustomerNumber: 'M1' }],
      ['the currency', { currency: 'CHF' }],
    ])('answers 400 for changing %s', async (_case, body) => {
      await patch(id, body).expect(400);
    });

    it('answers 404 for an unknown condition', async () => {
      await patch(999999, { amount: '1.00' }).expect(404);
    });

    it('has no DELETE endpoint', async () => {
      await http().delete(`/price-conditions/${id}`).expect(404);
      await expect(prisma.priceCondition.count()).resolves.toBe(1);
    });
  });

  describe('material currency changes', () => {
    it('are blocked while active conditions use the old currency', async () => {
      const { body } = await create(soldToBody).expect(201);
      const id = (body as { conditionId: number }).conditionId;

      const response = await http()
        .patch('/materials/MAT-1')
        .send({ currency: 'CHF' })
        .expect(422);
      expect((response.body as { message: string[] }).message).toEqual([
        'currency cannot be changed to CHF: material MAT-1 has 1 active price condition(s) in another currency',
      ]);

      // Other changes and the same currency stay possible
      await http()
        .patch('/materials/MAT-1')
        .send({ price: 4600, currency: 'EUR' })
        .expect(200);

      // After deactivating the condition, the currency can change ...
      await http()
        .patch(`/price-conditions/${id}`)
        .send({ isActive: false })
        .expect(200);
      await http()
        .patch('/materials/MAT-1')
        .send({ currency: 'CHF' })
        .expect(200);

      // ... and the old condition cannot be reactivated in EUR
      const reactivation = await http()
        .patch(`/price-conditions/${id}`)
        .send({ isActive: true })
        .expect(422);
      expect((reactivation.body as { message: string[] }).message).toEqual([
        'currency must be CHF, the currency of material MAT-1',
      ]);
    });

    it('still answer 404 for an unknown material', async () => {
      await http()
        .patch('/materials/NOPE')
        .send({ currency: 'CHF' })
        .expect(404);
    });
  });
});
