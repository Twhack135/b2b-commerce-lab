import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createCustomers,
  createTestApp,
  membership,
  resetDatabase,
} from './helpers';

const validUnit = {
  unitId: 'UNIT-1',
  name: 'Hamburg Plant',
  accountCustomerNumber: 'ACC',
  soldToCustomerNumber: 'ACC',
  billToCustomerNumber: 'BP1',
  payerCustomerNumber: 'ACC',
  shipToCustomerNumbers: ['SH1', 'SH2'],
  defaultShipToCustomerNumber: 'SH1',
};

describe('B2B units API', () => {
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
    await createCustomers(
      prisma,
      ['ACC', 'SH1', 'SH2', 'SH3', 'BP1', 'OLD', 'OTHER', 'OM', 'LONE'],
      ['OLD'],
    );
    await prisma.customerAccountMember.createMany({
      data: [
        membership('ACC', 'ACC'),
        ...['SH1', 'SH2', 'SH3', 'BP1', 'OLD'].map((c) => membership(c, 'ACC')),
        membership('OTHER', 'OTHER'),
        membership('OM', 'OTHER'),
      ],
    });
  });

  const createUnit = (body: Record<string, unknown> = validUnit) =>
    http().post('/b2b-units').send(body);
  const patchUnit = (body: Record<string, unknown>) =>
    http().patch('/b2b-units/UNIT-1').send(body);

  /** Ship-to rows as stored in the database */
  const shipToRows = () =>
    prisma.b2bUnitShipTo.findMany({
      where: { unitId: 'UNIT-1' },
      orderBy: { customerNumber: 'asc' },
      select: { customerNumber: true, isDefault: true },
    });

  const summary = (n: string, isActive = true) => ({
    customerNumber: n,
    name: `Customer ${n}`,
    isActive,
  });

  describe('create', () => {
    it('creates a unit with partners and returns 201', async () => {
      const response = await createUnit().expect(201);

      expect(response.body).toEqual({
        unitId: 'UNIT-1',
        name: 'Hamburg Plant',
        isActive: true,
        account: summary('ACC'),
        soldTo: summary('ACC'),
        billTo: summary('BP1'),
        payer: summary('ACC'),
        shipTos: [
          { ...summary('SH1'), isDefault: true },
          { ...summary('SH2'), isDefault: false },
        ],
        defaultShipToCustomerNumber: 'SH1',
      });
      await expect(shipToRows()).resolves.toEqual([
        { customerNumber: 'SH1', isDefault: true },
        { customerNumber: 'SH2', isDefault: false },
      ]);
    });

    it('returns 409 for an existing unit ID', async () => {
      await createUnit().expect(201);
      const response = await createUnit().expect(409);
      expect(response.body.message).toBe('B2B unit UNIT-1 already exists');
    });

    it.each([
      [
        'a Bill-to from another account',
        { billToCustomerNumber: 'OM' },
        'billToCustomerNumber OM does not belong to account ACC',
      ],
      [
        'a ship-to without account',
        { shipToCustomerNumbers: ['SH1', 'LONE'] },
        'shipToCustomerNumbers LONE does not belong to account ACC',
      ],
      [
        'an inactive Payer',
        { payerCustomerNumber: 'OLD' },
        'payerCustomerNumber OLD is inactive',
      ],
      [
        'an unknown Sold-to',
        { soldToCustomerNumber: 'GHOST' },
        'soldToCustomerNumber GHOST does not exist',
      ],
      [
        'a member as account',
        { accountCustomerNumber: 'SH1' },
        'accountCustomerNumber SH1 is not a customer account',
      ],
      [
        'a default outside the list',
        { defaultShipToCustomerNumber: 'SH3' },
        'defaultShipToCustomerNumber must be one of shipToCustomerNumbers',
      ],
    ])(
      'rejects %s with 422 and writes nothing',
      async (_case, change, message) => {
        const response = await createUnit({ ...validUnit, ...change }).expect(
          422,
        );

        expect(response.body).toEqual({
          statusCode: 422,
          error: 'Unprocessable Entity',
          message: [message],
        });
        await expect(prisma.b2bUnit.count()).resolves.toBe(0);
        await expect(prisma.b2bUnitShipTo.count()).resolves.toBe(0);
      },
    );

    it('rejects invalid request bodies with 400', async () => {
      await createUnit({ ...validUnit, shipToCustomerNumbers: [] }).expect(400);
      await createUnit({
        ...validUnit,
        shipToCustomerNumbers: ['SH1', 'SH1'],
      }).expect(400);
      await createUnit({ ...validUnit, unitId: ' UNIT-1' }).expect(400);
      await createUnit({ ...validUnit, salesOrganization: '1000' }).expect(400);
    });
  });

  describe('read', () => {
    it('lists units and returns one unit', async () => {
      await createUnit().expect(201);

      const list = await http().get('/b2b-units').expect(200);
      expect((list.body as { unitId: string }[]).map((u) => u.unitId)).toEqual([
        'UNIT-1',
      ]);
      await http().get('/b2b-units/UNIT-1').expect(200);
    });

    it('returns 404 for an unknown unit', async () => {
      await http().get('/b2b-units/NOPE').expect(404);
      await http().patch('/b2b-units/NOPE').send({ name: 'X' }).expect(404);
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      await createUnit().expect(201);
    });

    it('replaces ship-tos and switches the default atomically', async () => {
      const response = await patchUnit({
        shipToCustomerNumbers: ['SH2', 'SH3'],
        defaultShipToCustomerNumber: 'SH3',
        billToCustomerNumber: 'SH2',
        payerCustomerNumber: 'BP1',
      }).expect(200);

      expect(response.body.defaultShipToCustomerNumber).toBe('SH3');
      expect(response.body.billTo.customerNumber).toBe('SH2');
      await expect(shipToRows()).resolves.toEqual([
        { customerNumber: 'SH2', isDefault: false },
        { customerNumber: 'SH3', isDefault: true },
      ]);
    });

    it('rejects removing the default without a new one and changes nothing', async () => {
      const before = await shipToRows();

      await patchUnit({ shipToCustomerNumbers: ['SH2'] }).expect(422);

      await expect(shipToRows()).resolves.toEqual(before);
    });

    it('rejects changing the unit ID, account or Sold-to with 400', async () => {
      await patchUnit({ unitId: 'UNIT-2' }).expect(400);
      await patchUnit({ accountCustomerNumber: 'OTHER' }).expect(400);
      await patchUnit({ soldToCustomerNumber: 'SH1' }).expect(400);
    });

    it('rejects a ship-to from another account with 422', async () => {
      await patchUnit({ shipToCustomerNumbers: ['SH1', 'OM'] }).expect(422);
    });

    it('deactivates and reactivates a unit', async () => {
      await patchUnit({ isActive: false }).expect(200);
      const response = await patchUnit({ isActive: true }).expect(200);
      expect(response.body.isActive).toBe(true);
    });

    it('keeps partners that became inactive, but rejects new inactive assignments', async () => {
      // BP1 and SH2 are deactivated after they were assigned
      await http()
        .patch('/customers/BP1')
        .send({ isActive: false })
        .expect(200);
      await http()
        .patch('/customers/SH2')
        .send({ isActive: false })
        .expect(200);

      const unit = await http().get('/b2b-units/UNIT-1').expect(200);
      expect(unit.body.billTo).toEqual(summary('BP1', false));

      // Unchanged assignments may stay
      await patchUnit({ name: 'Renamed' }).expect(200);
      await patchUnit({ shipToCustomerNumbers: ['SH1', 'SH2', 'SH3'] }).expect(
        200,
      );

      // New assignments of inactive customers are rejected
      const asPayer = await patchUnit({ payerCustomerNumber: 'BP1' }).expect(
        422,
      );
      expect(asPayer.body.message).toEqual([
        'payerCustomerNumber BP1 is inactive',
      ]);
      const asDefault = await patchUnit({
        defaultShipToCustomerNumber: 'SH2',
      }).expect(422);
      expect(asDefault.body.message).toEqual([
        'defaultShipToCustomerNumber SH2 is inactive',
      ]);
    });

    it('never ends with two defaults when two updates run at the same time', async () => {
      const results = await Promise.all([
        patchUnit({ defaultShipToCustomerNumber: 'SH2' }),
        patchUnit({
          shipToCustomerNumbers: ['SH1', 'SH2', 'SH3'],
          defaultShipToCustomerNumber: 'SH3',
        }),
      ]);

      for (const result of results) {
        expect([200, 409]).toContain(result.status);
      }
      expect(results.some((r) => r.status === 200)).toBe(true);
      const defaults = (await shipToRows()).filter((row) => row.isDefault);
      expect(defaults).toHaveLength(1);
    });
  });

  describe('existing master data APIs', () => {
    it('still serve materials and customers', async () => {
      await http()
        .post('/materials')
        .send({
          materialNumber: 'MAT-1',
          description: 'Pump',
          price: 10.5,
          currency: 'EUR',
        })
        .expect(201);
      await http().get('/materials/MAT-1').expect(200);
      const customers = await http().get('/customers').expect(200);
      expect((customers.body as unknown[]).length).toBe(9);
    });
  });
});
