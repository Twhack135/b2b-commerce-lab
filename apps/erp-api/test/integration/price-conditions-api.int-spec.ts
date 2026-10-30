import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createPricingData,
  createTestApp,
  GERMANY,
  LIST_PRICE_ID,
  POLAND,
  resetDatabase,
} from './helpers';

const ZP02 = {
  code: 'ZP02',
  name: 'Customer Net Price',
  conditionClass: 'PRICE',
  calculationType: 'QUANTITY',
};

const soldToBody = {
  conditionTypeCode: 'ZP02',
  ...GERMANY,
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
  ...GERMANY,
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
  // Conditions created by the test; the test data adds list prices from
  // LIST_PRICE_ID on
  const own = { conditionId: { lt: LIST_PRICE_ID } };
  const ownCount = () => prisma.priceCondition.count({ where: own });
  const ownListed = async () => {
    const { body } = await http().get('/price-conditions').expect(200);
    return (body as { conditionId: number }[]).filter(
      (c) => c.conditionId < LIST_PRICE_ID,
    );
  };

  describe('POST /price-conditions', () => {
    it('creates a Sold-to condition and returns it with summaries', async () => {
      const response = await create(soldToBody).expect(201);

      expect(response.body).toEqual({
        conditionId: expect.any(Number) as unknown,
        conditionType: ZP02,
        salesArea: GERMANY,
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
      const stored = await prisma.priceCondition.findFirstOrThrow({
        where: own,
      });
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
      await expect(ownCount()).resolves.toBe(1);
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
        'another currency than the sales area',
        { currency: 'PLN' },
        'currency must be EUR, the currency of sales area 1000/10/00',
      ],
      [
        'a Sold-to that is not assigned to the sales area',
        { ...POLAND, currency: 'PLN' },
        'soldToCustomerNumber ACC is not assigned to sales area 2000/10/00',
      ],
      [
        'a sales area that is not configured',
        { distributionChannel: '20' },
        'salesArea 1000/20/00 does not exist',
      ],
      [
        'ZP01 for a Sold-to (configured for the sales area only)',
        { conditionTypeCode: 'ZP01' },
        'conditionTypeCode ZP01 (List Price) cannot be used with scope SOLD_TO; allowed scopes: SALES_AREA',
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
      await expect(ownCount()).resolves.toBe(0);
    });
  });

  describe('GET /price-conditions', () => {
    it('lists conditions sorted by sales area, material, scope, key and start', async () => {
      await create({ ...soldToBody, validFrom: '2027-01-01', validTo: null });
      await create(soldToBody);
      await create(unitBody);
      await create({
        ...soldToBody,
        materialNumber: 'MAT-2',
        amount: '180.00',
      });

      const { body } = await http().get('/price-conditions').expect(200);

      expect(
        (
          body as {
            salesArea: typeof GERMANY;
            materialNumber: string;
            scope: string;
            validFrom: string;
          }[]
        ).map(
          (c) =>
            `${c.salesArea.salesOrganization} ${c.materialNumber} ${c.scope} ${c.validFrom}`,
        ),
      ).toEqual([
        '1000 MAT-1 B2B_UNIT 2026-01-01',
        '1000 MAT-1 SOLD_TO 2026-01-01',
        '1000 MAT-1 SOLD_TO 2027-01-01',
        '1000 MAT-1 SALES_AREA 1900-01-01',
        '1000 MAT-2 SOLD_TO 2026-01-01',
        '2000 MAT-2 SALES_AREA 1900-01-01',
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

      expect(await ownListed()).toMatchObject([
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
      ['the currency', { currency: 'PLN' }],
      ['the sales organization', { salesOrganization: '2000' }],
    ])('answers 400 for changing %s', async (_case, body) => {
      await patch(id, body).expect(400);
    });

    it('answers 404 for an unknown condition', async () => {
      await patch(999999, { amount: '1.00' }).expect(404);
    });

    it('has no DELETE endpoint', async () => {
      await http().delete(`/price-conditions/${id}`).expect(404);
      await expect(ownCount()).resolves.toBe(1);
    });
  });

  // Since Sprint 9C-B price and currency of a material are deprecated: they
  // are not tied to price conditions and never used for pricing
  describe('deprecated material price', () => {
    it('can change freely and does not touch any condition', async () => {
      await create(soldToBody).expect(201);
      const before = await prisma.priceCondition.findMany({
        orderBy: { conditionId: 'asc' },
      });

      await http()
        .patch('/materials/MAT-1')
        .send({ price: 1, currency: 'CHF' })
        .expect(200);

      await expect(
        prisma.priceCondition.findMany({ orderBy: { conditionId: 'asc' } }),
      ).resolves.toEqual(before);
    });

    it('is optional for new materials', async () => {
      const { body } = await http()
        .post('/materials')
        .send({ materialNumber: 'MAT-9', description: 'Valve' })
        .expect(201);
      expect(body).toEqual({
        materialNumber: 'MAT-9',
        description: 'Valve',
        price: null,
        currency: null,
      });
    });
  });
});
