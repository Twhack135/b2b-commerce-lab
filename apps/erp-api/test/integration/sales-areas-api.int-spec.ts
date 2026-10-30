import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createCustomers,
  createTestApp,
  GERMANY,
  membership,
  POLAND,
  resetDatabase,
} from './helpers';

const unitBody = (overrides: Record<string, unknown> = {}) => ({
  unitId: 'UNIT-1',
  name: 'Unit 1',
  ...GERMANY,
  accountCustomerNumber: 'ACC',
  soldToCustomerNumber: 'ACC',
  billToCustomerNumber: 'ACC',
  payerCustomerNumber: 'ACC',
  shipToCustomerNumbers: ['SH1'],
  defaultShipToCustomerNumber: 'SH1',
  ...overrides,
});

describe('Sales areas and currencies', () => {
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
    // Account ACC with members SH1 and SH2; all assigned to Germany
    await createCustomers(prisma, ['ACC', 'SH1', 'SH2']);
    await prisma.customerAccountMember.createMany({
      data: ['ACC', 'SH1', 'SH2'].map((c) => membership(c, 'ACC')),
    });
  });

  const assign = (customer: string, area: Record<string, unknown>) =>
    http().post(`/customers/${customer}/sales-areas`).send(area);
  const setAssignment = (
    customer: string,
    area: typeof GERMANY,
    body: Record<string, unknown>,
  ) =>
    http()
      .patch(
        `/customers/${customer}/sales-areas/${area.salesOrganization}/${area.distributionChannel}/${area.division}`,
      )
      .send(body);
  const assignmentOf = (customerNumber: string, area: typeof GERMANY) =>
    prisma.customerSalesArea.findUnique({
      where: {
        customerNumber_salesOrganization_distributionChannel_division: {
          customerNumber,
          ...area,
        },
      },
    });

  describe('configuration (read-only)', () => {
    it('lists the currencies with their decimal places', async () => {
      const response = await http().get('/currencies').expect(200);
      expect(response.body).toEqual([
        { code: 'EUR', name: 'Euro', decimals: 2, isActive: true },
        { code: 'JPY', name: 'Japanese Yen', decimals: 0, isActive: true },
        { code: 'PLN', name: 'Polish Zloty', decimals: 2, isActive: true },
      ]);
    });

    it('lists the sales areas with names, country and currency', async () => {
      const response = await http().get('/sales-areas').expect(200);
      expect(response.body).toEqual([
        {
          ...GERMANY,
          salesOrganizationName: 'B2B Lab Germany',
          distributionChannelName: 'Direct Sales',
          divisionName: 'Cross-Division',
          country: 'DE',
          currency: 'EUR',
          currencyDecimals: 2,
          isActive: true,
        },
        expect.objectContaining({
          ...POLAND,
          country: 'PL',
          currency: 'PLN',
          currencyDecimals: 2,
        }),
        expect.objectContaining({
          salesOrganization: '3000',
          country: 'JP',
          currency: 'JPY',
          currencyDecimals: 0,
        }),
      ]);
    });

    it('lists sales organizations, distribution channels and divisions', async () => {
      const organizations = await http()
        .get('/sales-organizations')
        .expect(200);
      expect(
        organizations.body.map(
          (o: { code: string; currency: string }) => `${o.code}:${o.currency}`,
        ),
      ).toEqual(['1000:EUR', '2000:PLN', '3000:JPY']);
      await http()
        .get('/distribution-channels')
        .expect(200, [{ code: '10', name: 'Direct Sales' }]);
      await http()
        .get('/divisions')
        .expect(200, [{ code: '00', name: 'Cross-Division' }]);
    });

    it('cannot be changed through the API', async () => {
      await http().post('/currencies').send({ code: 'USD' }).expect(404);
      await http().post('/sales-areas').send(POLAND).expect(404);
    });
  });

  describe('customer assignments', () => {
    it('lists the assignments with the customer', async () => {
      const response = await http().get('/customers/ACC').expect(200);
      expect(response.body.salesAreas).toEqual([
        { ...GERMANY, isActive: true },
      ]);
    });

    it('assigns a customer to several sales areas', async () => {
      const response = await assign('ACC', POLAND).expect(201);
      expect(response.body).toEqual({
        customerNumber: 'ACC',
        ...POLAND,
        isActive: true,
      });

      const customer = await http().get('/customers/ACC').expect(200);
      expect(customer.body.salesAreas).toEqual([
        { ...GERMANY, isActive: true },
        { ...POLAND, isActive: true },
      ]);
    });

    it('rejects a second assignment to the same sales area with 409', async () => {
      const response = await assign('ACC', GERMANY).expect(409);
      expect(response.body.message).toBe(
        'Customer ACC is already assigned to sales area 1000/10/00',
      );
    });

    it.each([
      [
        { ...GERMANY, distributionChannel: '20' },
        'salesArea 1000/20/00 does not exist',
      ],
      [
        { ...GERMANY, salesOrganization: '9999' },
        'salesArea 9999/10/00 does not exist',
      ],
    ])(
      'rejects a combination that is not configured with 422',
      async (area, message) => {
        const response = await assign('ACC', area).expect(422);
        expect(response.body.message).toEqual([message]);
      },
    );

    it('rejects an inactive sales area with 422', async () => {
      await prisma.salesArea.update({
        where: { salesOrganization_distributionChannel_division: POLAND },
        data: { isActive: false },
      });
      try {
        const response = await assign('ACC', POLAND).expect(422);
        expect(response.body.message).toEqual([
          'salesArea 2000/10/00 is inactive',
        ]);
      } finally {
        // Configuration is not reset between tests
        await prisma.salesArea.update({
          where: { salesOrganization_distributionChannel_division: POLAND },
          data: { isActive: true },
        });
      }
    });

    it.each([
      [
        'a malformed sales organization',
        { ...POLAND, salesOrganization: '20' },
      ],
      ['a numeric division', { ...POLAND, division: 0 }],
      [
        'a missing distribution channel',
        { ...POLAND, distributionChannel: undefined },
      ],
      ['an unexpected property', { ...POLAND, isActive: false }],
    ])('rejects %s with 400', async (_case, body) => {
      await assign('ACC', body).expect(400);
    });

    it('returns 404 for an unknown customer', async () => {
      const response = await assign('GHOST', POLAND).expect(404);
      expect(response.body.message).toBe('Customer GHOST not found');
    });

    it('deactivates and reactivates an unused assignment', async () => {
      await setAssignment('SH2', GERMANY, { isActive: false }).expect(200, {
        customerNumber: 'SH2',
        ...GERMANY,
        isActive: false,
      });
      await setAssignment('SH2', GERMANY, { isActive: true }).expect(200, {
        customerNumber: 'SH2',
        ...GERMANY,
        isActive: true,
      });
    });

    it('refuses to deactivate an assignment that active units depend on', async () => {
      await http().post('/b2b-units').send(unitBody()).expect(201);
      await http()
        .post('/b2b-units')
        .send(
          unitBody({ unitId: 'UNIT-2', shipToCustomerNumbers: ['SH1', 'SH2'] }),
        )
        .expect(201);

      const response = await setAssignment('SH1', GERMANY, {
        isActive: false,
      }).expect(409);
      expect(response.body.message).toBe(
        'Customer SH1 cannot be deactivated in sales area 1000/10/00: it is a partner of the active B2B unit(s) UNIT-1, UNIT-2. Deactivate these units or replace the partner first.',
      );
      await expect(assignmentOf('SH1', GERMANY)).resolves.toMatchObject({
        isActive: true,
      });
    });

    it('allows deactivation when only inactive units use it, but then blocks their reactivation', async () => {
      await http()
        .post('/b2b-units')
        .send(unitBody({ isActive: false }))
        .expect(201);
      await setAssignment('SH1', GERMANY, { isActive: false }).expect(200);

      const response = await http()
        .patch('/b2b-units/UNIT-1')
        .send({ isActive: true })
        .expect(422);
      expect(response.body.message).toEqual([
        'shipToCustomerNumbers SH1 is inactive in sales area 1000/10/00',
      ]);

      await setAssignment('SH1', GERMANY, { isActive: true }).expect(200);
      await http()
        .patch('/b2b-units/UNIT-1')
        .send({ isActive: true })
        .expect(200);
    });

    it('returns 404 for an assignment that does not exist', async () => {
      const response = await setAssignment('ACC', POLAND, {
        isActive: false,
      }).expect(404);
      expect(response.body.message).toBe(
        'Customer ACC is not assigned to sales area 2000/10/00',
      );
      await http()
        .patch('/customers/ACC/sales-areas/10/10/00')
        .send({ isActive: false })
        .expect(404);
      await http()
        .patch('/customers/GHOST/sales-areas/1000/10/00')
        .send({ isActive: false })
        .expect(404, {
          message: 'Customer GHOST not found',
          error: 'Not Found',
          statusCode: 404,
        });
    });

    it.each([
      ['without isActive', {}],
      ['with isActive as text', { isActive: 'false' }],
      [
        'changing the sales area',
        { isActive: true, salesOrganization: '2000' },
      ],
    ])('rejects a change %s with 400', async (_case, body) => {
      await setAssignment('ACC', GERMANY, body).expect(400);
    });
  });

  describe('B2B units in a sales area', () => {
    it('returns the sales area of a unit', async () => {
      const response = await http()
        .post('/b2b-units')
        .send(unitBody())
        .expect(201);
      expect(response.body.salesArea).toEqual(GERMANY);
      const stored = await prisma.b2bUnitShipTo.findMany({
        where: { unitId: 'UNIT-1' },
      });
      expect(stored).toEqual([
        expect.objectContaining({ customerNumber: 'SH1', ...GERMANY }),
      ]);
    });

    it('rejects partners that are not assigned to the sales area of the unit', async () => {
      const response = await http()
        .post('/b2b-units')
        .send(unitBody(POLAND))
        .expect(422);
      expect(response.body.message).toEqual([
        'soldToCustomerNumber ACC is not assigned to sales area 2000/10/00',
        'billToCustomerNumber ACC is not assigned to sales area 2000/10/00',
        'payerCustomerNumber ACC is not assigned to sales area 2000/10/00',
        'shipToCustomerNumbers SH1 is not assigned to sales area 2000/10/00',
      ]);
      await expect(prisma.b2bUnit.count()).resolves.toBe(0);
    });

    it('creates a unit in another sales area once the partners are assigned there', async () => {
      await assign('ACC', POLAND).expect(201);
      await assign('SH1', POLAND).expect(201);

      const response = await http()
        .post('/b2b-units')
        .send(unitBody({ unitId: 'UNIT-PL', ...POLAND }))
        .expect(201);
      expect(response.body.salesArea).toEqual(POLAND);
    });

    it('rejects an inactive partner assignment for a new ship-to', async () => {
      await http().post('/b2b-units').send(unitBody()).expect(201);
      await setAssignment('SH2', GERMANY, { isActive: false }).expect(200);

      const response = await http()
        .patch('/b2b-units/UNIT-1')
        .send({ shipToCustomerNumbers: ['SH1', 'SH2'] })
        .expect(422);
      expect(response.body.message).toEqual([
        'shipToCustomerNumbers SH2 is inactive in sales area 1000/10/00',
      ]);
    });

    it('rejects a sales area that is not configured', async () => {
      const response = await http()
        .post('/b2b-units')
        .send(
          unitBody({ salesOrganization: '3000', distributionChannel: '20' }),
        )
        .expect(422);
      expect(response.body.message).toEqual([
        'salesArea 3000/20/00 does not exist',
      ]);
    });

    it.each([
      ['salesOrganization', { salesOrganization: '2000' }],
      ['distributionChannel', { distributionChannel: '10' }],
      ['division', { division: '00' }],
    ])(
      'does not allow changing the %s of a unit (400)',
      async (_field, body) => {
        await http().post('/b2b-units').send(unitBody()).expect(201);
        await http().patch('/b2b-units/UNIT-1').send(body).expect(400);
      },
    );
  });

  describe('database rules (bypassing the services)', () => {
    const insertUnit = (area = GERMANY, soldTo = 'ACC') =>
      prisma.b2bUnit.create({
        data: {
          unitId: 'U-DB',
          name: 'Direct insert',
          accountCustomerNumber: 'ACC',
          soldToCustomerNumber: soldTo,
          billToCustomerNumber: 'ACC',
          payerCustomerNumber: 'ACC',
          ...area,
        },
      });

    it('rejects a unit in a sales area that does not exist', async () => {
      await expect(
        insertUnit({ ...GERMANY, distributionChannel: '20' }),
      ).rejects.toThrow(/Foreign key constraint/);
    });

    it('rejects a unit whose partners are not assigned to its sales area', async () => {
      await expect(insertUnit(POLAND)).rejects.toThrow(
        /Foreign key constraint/,
      );
    });

    it('rejects a ship-to in another sales area than its unit', async () => {
      await insertUnit();
      await prisma.customerSalesArea.create({
        data: { customerNumber: 'SH1', ...POLAND },
      });
      await expect(
        prisma.b2bUnitShipTo.create({
          data: {
            unitId: 'U-DB',
            customerNumber: 'SH1',
            accountCustomerNumber: 'ACC',
            isDefault: true,
            ...POLAND,
          },
        }),
      ).rejects.toThrow(/Foreign key constraint/);
    });

    it('checks that a ship-to assignment exists; whether it is active is a service rule', async () => {
      await insertUnit();
      await prisma.customerSalesArea.update({
        where: {
          customerNumber_salesOrganization_distributionChannel_division: {
            customerNumber: 'ACC',
            ...GERMANY,
          },
        },
        data: { isActive: false },
      });
      // Existence is a database rule; "active" is a service rule
      await expect(
        prisma.b2bUnitShipTo.create({
          data: {
            unitId: 'U-DB',
            customerNumber: 'ACC',
            accountCustomerNumber: 'ACC',
            isDefault: true,
            ...GERMANY,
          },
        }),
      ).resolves.toBeDefined();
      await prisma.$executeRaw`DELETE FROM b2b_unit_ship_tos`;
      await prisma.$executeRaw`DELETE FROM customer_sales_areas WHERE customer_number = 'SH2'`;
      await expect(
        prisma.b2bUnitShipTo.create({
          data: {
            unitId: 'U-DB',
            customerNumber: 'SH2',
            accountCustomerNumber: 'ACC',
            isDefault: true,
            ...GERMANY,
          },
        }),
      ).rejects.toThrow(/Foreign key constraint/);
    });

    it('keeps the sales area of a unit with ship-tos from being changed', async () => {
      await http().post('/b2b-units').send(unitBody()).expect(201);
      // Even with all partners assigned to Poland
      await prisma.customerSalesArea.createMany({
        data: ['ACC', 'SH1'].map((customerNumber) => ({
          customerNumber,
          ...POLAND,
        })),
      });
      await expect(
        prisma.$executeRaw`UPDATE b2b_units SET sales_organization = '2000' WHERE unit_id = 'UNIT-1'`,
      ).rejects.toThrow();
    });

    it('rejects deleting an assignment that a unit uses', async () => {
      await http().post('/b2b-units').send(unitBody()).expect(201);
      await expect(
        prisma.$executeRaw`DELETE FROM customer_sales_areas WHERE customer_number = 'SH1'`,
      ).rejects.toThrow();
    });

    it.each([
      [
        'a currency code in lower case',
        `INSERT INTO currencies (code, name, decimals) VALUES ('usd', 'US Dollar', 2)`,
      ],
      [
        'more than 3 decimal places',
        `INSERT INTO currencies (code, name, decimals) VALUES ('BHX', 'Test', 4)`,
      ],
      [
        'negative decimal places',
        `INSERT INTO currencies (code, name, decimals) VALUES ('BHY', 'Test', -1)`,
      ],
      [
        'a blank currency name',
        `INSERT INTO currencies (code, name, decimals) VALUES ('BHZ', '  ', 2)`,
      ],
      [
        'a short sales organization code',
        `INSERT INTO sales_organizations (code, name, country, currency_code, time_zone) VALUES ('10', 'Test', 'DE', 'EUR', 'Europe/Berlin')`,
      ],
      [
        'an unknown currency',
        `INSERT INTO sales_organizations (code, name, country, currency_code, time_zone) VALUES ('4000', 'Test', 'US', 'USD', 'America/New_York')`,
      ],
      [
        'a lower-case country',
        `INSERT INTO sales_organizations (code, name, country, currency_code, time_zone) VALUES ('4000', 'Test', 'us', 'EUR', 'America/New_York')`,
      ],
      [
        'a one-character distribution channel',
        `INSERT INTO distribution_channels (code, name) VALUES ('1', 'Test')`,
      ],
      [
        'a division with a lower-case letter',
        `INSERT INTO divisions (code, name) VALUES ('a1', 'Test')`,
      ],
    ])('rejects %s (CHECK and foreign keys)', async (_case, sql) => {
      // Fixed statements, never user input
      await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow();
    });
  });

  describe('concurrency', () => {
    it('never leaves an active unit with a deactivated partner assignment', async () => {
      for (let round = 0; round < 10; round++) {
        await prisma.$executeRaw`DELETE FROM b2b_unit_ship_tos`;
        await prisma.$executeRaw`DELETE FROM b2b_units`;
        await prisma.$executeRaw`UPDATE customer_sales_areas SET is_active = true`;

        // Create a unit with SH2 and deactivate SH2 at the same time
        const [created, deactivated] = await Promise.all([
          http()
            .post('/b2b-units')
            .send(
              unitBody({
                shipToCustomerNumbers: ['SH2'],
                defaultShipToCustomerNumber: 'SH2',
              }),
            ),
          setAssignment('SH2', GERMANY, { isActive: false }),
        ]);

        // Exactly one of them wins
        expect(
          [created.status, deactivated.status].sort((a, b) => a - b),
        ).toEqual(created.status === 201 ? [201, 409] : [200, 422]);
        const activeUnits = await prisma.b2bUnit.count({
          where: { isActive: true },
        });
        const assignment = await assignmentOf('SH2', GERMANY);
        expect(activeUnits === 1 ? assignment?.isActive : true).toBe(true);
      }
    });
  });
});
