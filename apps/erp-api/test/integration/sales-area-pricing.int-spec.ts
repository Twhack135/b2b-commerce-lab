// Market-specific pricing (Sprint 9C-B) end to end: list prices (ZP01) per
// sales area, currencies of the sales areas (JPY without decimal places),
// isolation between markets and the German reference results.
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createMuellerData,
  createTestApp,
  GERMANY,
  JAPAN,
  LIST_PRICE_ID,
  POLAND,
  resetDatabase,
} from './helpers';

const today = '2026-11-15';

describe('Market-specific pricing', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  const condition = (body: object) =>
    http().post('/price-conditions').send(body);
  const listPrice = (
    salesArea: typeof GERMANY,
    materialNumber: string,
    amount: string,
  ) =>
    condition({
      conditionTypeCode: 'ZP01',
      ...salesArea,
      materialNumber,
      scope: 'SALES_AREA',
      amount,
      validFrom: '2026-01-01',
    });
  const price = (body: object) =>
    http()
      .post('/pricing/price')
      .send({ pricingDate: today, ...body });
  const simulate = (body: object) =>
    http()
      .post('/sales-orders/simulate')
      .send({ pricingDate: today, ...body })
      .expect(200);
  const messagesOf = (response: { body: unknown }) =>
    (response.body as { message: string[] }).message;

  // The Müller account also buys in Japan through UNIT-OSAKA
  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMuellerData(prisma);
    for (const customerNumber of ['CUST-1000', 'CUST-1100']) {
      await http()
        .post(`/customers/${customerNumber}/sales-areas`)
        .send(JAPAN)
        .expect(201);
    }
    await http()
      .post('/b2b-units')
      .send({
        unitId: 'UNIT-OSAKA',
        name: 'Müller – Osaka',
        ...JAPAN,
        accountCustomerNumber: 'CUST-1000',
        soldToCustomerNumber: 'CUST-1000',
        billToCustomerNumber: 'CUST-1000',
        payerCustomerNumber: 'CUST-1000',
        shipToCustomerNumbers: ['CUST-1100'],
        defaultShipToCustomerNumber: 'CUST-1100',
      })
      .expect(201);
  });

  describe('German reference results', () => {
    it('keeps every German price and the Stuttgart total of 10,695.00 EUR', async () => {
      // The active ZP03 special price of the development data
      await condition({
        conditionTypeCode: 'ZP03',
        ...GERMANY,
        materialNumber: 'MAT-001',
        scope: 'SOLD_TO',
        soldToCustomerNumber: 'CUST-1000',
        amount: '4400.00',
        validFrom: '2026-10-29',
      }).expect(201);

      const unitPrice = async (materialNumber: string, unitId: string) =>
        (await price({ ...GERMANY, materialNumber, unitId }).expect(200))
          .body as { unitPrice: string; conditionType: { code: string } };

      await expect(
        unitPrice('MAT-002', 'UNIT-STUTTGART'),
      ).resolves.toMatchObject({
        unitPrice: '189.50',
        conditionType: { code: 'ZP02' },
      });
      await expect(
        unitPrice('MAT-002', 'UNIT-MUENCHEN'),
      ).resolves.toMatchObject({
        unitPrice: '179.00',
        conditionType: { code: 'ZP02' },
      });
      await expect(
        unitPrice('MAT-001', 'UNIT-STUTTGART'),
      ).resolves.toMatchObject({
        unitPrice: '4400.00',
        conditionType: { code: 'ZP03' },
      });
      // The list price itself is still 4,500.00 EUR (ZP01)
      const listed = await http()
        .get(`/price-conditions/${LIST_PRICE_ID}`)
        .expect(200);
      expect(listed.body).toMatchObject({
        conditionType: { code: 'ZP01' },
        scope: 'SALES_AREA',
        amount: '4500.00',
        currency: 'EUR',
      });

      const { body } = await simulate({
        ...GERMANY,
        unitId: 'UNIT-STUTTGART',
        items: [
          { materialNumber: 'MAT-001', quantity: 2 },
          { materialNumber: 'MAT-002', quantity: 10 },
        ],
      });
      expect(body).toMatchObject({
        status: 'VALID',
        currency: 'EUR',
        totals: { netValue: '10695.00', currency: 'EUR' },
      });
    });
  });

  describe('Japan (JPY, no decimal places)', () => {
    it('has no prices until they are maintained', async () => {
      const response = await price({
        ...JAPAN,
        materialNumber: 'MAT-001',
        unitId: 'UNIT-OSAKA',
      }).expect(422);
      expect(response.body).toMatchObject({ code: 'NO_PRICE_FOUND' });
    });

    it('prices with a Japanese list price in JPY', async () => {
      const created = await listPrice(JAPAN, 'MAT-001', '700000').expect(201);
      expect(created.body).toMatchObject({
        salesArea: JAPAN,
        amount: '700000',
        currency: 'JPY',
      });

      const { body } = await price({
        ...JAPAN,
        materialNumber: 'MAT-001',
        unitId: 'UNIT-OSAKA',
        quantity: 3,
      }).expect(200);
      expect(body).toMatchObject({
        salesArea: JAPAN,
        unitPrice: '700000',
        netValue: '2100000',
        currency: 'JPY',
        source: 'SALES_AREA',
      });
    });

    it('rejects JPY amounts with decimal places', async () => {
      const response = await listPrice(JAPAN, 'MAT-001', '700000.50').expect(
        422,
      );
      expect(messagesOf(response)).toEqual([
        'amount must be a whole amount: JPY has no decimal places',
      ]);
      const created = await listPrice(JAPAN, 'MAT-001', '700000.00').expect(
        201,
      );
      const id = (created.body as { conditionId: number }).conditionId;
      await http()
        .patch(`/price-conditions/${id}`)
        .send({ amount: '699999.99' })
        .expect(422);
    });

    it('takes the currency from the sales area and rejects another one', async () => {
      const response = await condition({
        conditionTypeCode: 'ZP01',
        ...JAPAN,
        materialNumber: 'MAT-001',
        scope: 'SALES_AREA',
        amount: '700000',
        currency: 'EUR',
        validFrom: '2026-01-01',
      }).expect(422);
      expect(messagesOf(response)).toEqual([
        'currency must be JPY, the currency of sales area 3000/10/00',
      ]);
    });

    it('uses a Japanese customer price before the list price', async () => {
      await listPrice(JAPAN, 'MAT-001', '700000').expect(201);
      await condition({
        conditionTypeCode: 'ZP02',
        ...JAPAN,
        materialNumber: 'MAT-001',
        scope: 'SOLD_TO',
        soldToCustomerNumber: 'CUST-1000',
        amount: '650000',
        validFrom: '2026-01-01',
      }).expect(201);

      const { body } = await simulate({
        ...JAPAN,
        unitId: 'UNIT-OSAKA',
        items: [
          { materialNumber: 'MAT-001', quantity: 2 },
          { materialNumber: 'MAT-002', quantity: 1 },
        ],
      });
      const result = body as {
        status: string;
        currency: string;
        items: {
          unitPrice: string | null;
          netValue: string | null;
          messages: { code: string }[];
        }[];
      };

      expect(result).toMatchObject({ status: 'INVALID', currency: 'JPY' });
      expect(result.items[0]).toMatchObject({
        unitPrice: '650000',
        netValue: '1300000',
      });
      // The German Sold-to price of MAT-002 is never used in Japan
      expect(result.items[1].messages.map((m) => m.code)).toEqual([
        'NO_PRICE_FOUND',
      ]);
    });

    it('totals a Japanese order in JPY without decimal places', async () => {
      await listPrice(JAPAN, 'MAT-001', '700000').expect(201);
      await listPrice(JAPAN, 'MAT-002', '29500').expect(201);

      const { body } = await simulate({
        ...JAPAN,
        unitId: 'UNIT-OSAKA',
        items: [
          { materialNumber: 'MAT-001', quantity: 2 },
          { materialNumber: 'MAT-002', quantity: 10 },
        ],
      });

      expect(body).toMatchObject({
        status: 'VALID',
        salesArea: JAPAN,
        currency: 'JPY',
        totals: { netValue: '1695000', currency: 'JPY' },
      });
    });
  });

  describe('isolation between markets', () => {
    it('never prices a unit with the conditions of another sales area', async () => {
      await listPrice(JAPAN, 'MAT-001', '700000').expect(201);

      const german = await price({
        ...JAPAN,
        materialNumber: 'MAT-001',
        unitId: 'UNIT-STUTTGART',
      }).expect(422);
      expect(messagesOf(german)).toEqual([
        'unitId UNIT-STUTTGART belongs to sales area 1000/10/00, not 3000/10/00',
      ]);

      const japanese = await price({
        ...GERMANY,
        materialNumber: 'MAT-001',
        unitId: 'UNIT-OSAKA',
      }).expect(422);
      expect(messagesOf(japanese)).toEqual([
        'unitId UNIT-OSAKA belongs to sales area 3000/10/00, not 1000/10/00',
      ]);
    });

    it('rejects conditions for partners of another market', async () => {
      const soldTo = await condition({
        conditionTypeCode: 'ZP02',
        ...POLAND,
        materialNumber: 'MAT-001',
        scope: 'SOLD_TO',
        soldToCustomerNumber: 'CUST-1000',
        amount: '1999.00',
        validFrom: '2026-01-01',
      }).expect(422);
      expect(messagesOf(soldTo)).toEqual([
        'soldToCustomerNumber CUST-1000 is not assigned to sales area 2000/10/00',
      ]);

      const unit = await condition({
        conditionTypeCode: 'ZP02',
        ...JAPAN,
        materialNumber: 'MAT-001',
        scope: 'B2B_UNIT',
        unitId: 'UNIT-STUTTGART',
        amount: '650000',
        validFrom: '2026-01-01',
      }).expect(422);
      expect(messagesOf(unit)).toEqual([
        'unitId UNIT-STUTTGART belongs to sales area 1000/10/00, not 3000/10/00',
      ]);
    });

    it('allows the same material in every market with its own list price', async () => {
      await listPrice(POLAND, 'MAT-001', '19999.00').expect(201);
      await listPrice(JAPAN, 'MAT-001', '700000').expect(201);

      const { body } = await http().get('/price-conditions').expect(200);
      expect(
        (
          body as {
            salesArea: typeof GERMANY;
            materialNumber: string;
            scope: string;
            amount: string;
            currency: string;
          }[]
        )
          .filter((c) => c.materialNumber === 'MAT-001')
          .map(
            (c) =>
              `${c.salesArea.salesOrganization} ${c.scope} ${c.amount} ${c.currency}`,
          ),
      ).toEqual([
        '1000 SALES_AREA 4500.00 EUR',
        '2000 SALES_AREA 19999.00 PLN',
        '3000 SALES_AREA 700000 JPY',
      ]);
    });

    it('does not invent prices for Poland', async () => {
      const polish = await prisma.priceCondition.findMany({
        where: { salesOrganization: '2000' },
      });
      // Only the Polish test material of the test data
      expect(polish.map((c) => c.materialNumber)).toEqual(['MAT-PL']);
    });
  });
});
