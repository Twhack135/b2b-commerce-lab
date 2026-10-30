import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createListPrices,
  createMuellerData,
  createTestApp,
  GERMANY,
  JAPAN,
  membership,
  resetDatabase,
  tableFingerprint,
  TestClock,
} from './helpers';

// Sales orders (Sprint 10B). The test data is shaped like the development
// data: the Müller order from Stuttgart (2 x MAT-001, 10 x MAT-002) costs
// 2 x 4400.00 (ZP03 Sold-to) + 10 x 189.50 (ZP02 Sold-to) = 10695.00 EUR.

/** 2026-11-15, 11:00 in Germany (CET) */
const MORNING = '2026-11-15T10:00:00.000Z';
const MASTER_TABLES = [
  'materials',
  'customers',
  'customer_account_members',
  'customer_sales_areas',
  'b2b_units',
  'b2b_unit_ship_tos',
  'price_conditions',
];

type Order = {
  salesOrderNumber: string;
  requestId: string;
  status: string;
  deliveryBlock: string | null;
  salesArea: typeof GERMANY;
  currency: string;
  currencyDecimals: number;
  orderDate: string;
  timeZone: string;
  requestedDeliveryDate: string | null;
  requestedShippingMethod: string;
  customerReference: string | null;
  customerNote: string | null;
  unit: { unitId: string; name: string };
  partners: Record<
    string,
    { customerNumber: string; name: string; street: string; city: string }
  >;
  items: {
    itemNumber: number;
    materialNumber: string;
    materialDescription: string;
    quantity: number;
    unitPrice: string;
    netValue: string;
    conditions: {
      stepNumber: number;
      conditionType: { code: string };
      source: string;
      conditionId: number;
      amount: string;
      value: string;
    }[];
  }[];
  totals: { netValue: string; currency: string; includes: string };
};

/** A position with the unit price the user confirmed */
const item = (
  materialNumber: string,
  quantity: number,
  expectedUnitPrice: string,
) => ({ materialNumber, quantity, expectedUnitPrice });

type ErrorBody = {
  statusCode: number;
  code?: string;
  message: string[];
  salesOrderNumber?: string;
  changedItems?: {
    itemNumber: number;
    materialNumber: string;
    expectedUnitPrice: string;
    unitPrice: string | null;
  }[];
  expectedTotal?: { netValue: string; currency: string };
  evaluation?: {
    status: string;
    pricingDate: string;
    totals: { netValue: string } | null;
    messages: { code: string }[];
    items: { messages: { code: string }[] }[];
  };
};

const muellerOrder = (change: object = {}) => ({
  requestId: randomUUID(),
  ...GERMANY,
  unitId: 'UNIT-STUTTGART',
  customerReference: 'PO-STR-2026-118',
  items: [item('MAT-001', 2, '4400.00'), item('MAT-002', 10, '189.50')],
  expectedTotal: { netValue: '10695.00', currency: 'EUR' },
  ...change,
});

describe('Sales orders API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];
  const clock = new TestClock(new Date(MORNING));
  /** ID of the ZP03 Sold-to price of MAT-001 (4400.00), like condition #4 */
  let specialPriceId: number;
  /** ID of the ZP02 Sold-to price of MAT-002 (189.50) */
  let soldToPriceId: number;

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp({ clock }));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    clock.set(MORNING);
    await resetDatabase(prisma);
    await createMuellerData(prisma);
    const special = await prisma.priceCondition.create({
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
    specialPriceId = special.conditionId;
    soldToPriceId = (
      await prisma.priceCondition.findFirstOrThrow({
        where: { materialNumber: 'MAT-002', scope: 'SOLD_TO' },
      })
    ).conditionId;
  });

  const create = (body: object) => http().post('/sales-orders').send(body);
  const orderCount = () => prisma.salesOrder.count();

  describe('creating an order', () => {
    it('creates the Müller order with server date, snapshots and exact prices', async () => {
      const body = muellerOrder();
      const response = await create(body).expect(201);
      const order = response.body as Order;

      expect(response.headers.location).toBe('/sales-orders/1000000001');
      expect(order).toMatchObject({
        salesOrderNumber: '1000000001',
        requestId: body.requestId,
        status: 'OPEN',
        deliveryBlock: null,
        salesArea: GERMANY,
        currency: 'EUR',
        currencyDecimals: 2,
        orderDate: '2026-11-15',
        timeZone: 'Europe/Berlin',
        requestedDeliveryDate: null,
        requestedShippingMethod: 'STANDARD',
        customerReference: 'PO-STR-2026-118',
        customerNote: null,
        unit: { unitId: 'UNIT-STUTTGART', name: 'Müller UNIT-STUTTGART' },
        totals: {
          netValue: '10695.00',
          currency: 'EUR',
          includes: 'NET_EXCL_TAX_AND_FREIGHT',
        },
      });
      expect(
        Object.entries(order.partners).map(
          ([role, p]) => `${role}:${p.customerNumber}`,
        ),
      ).toEqual([
        'soldTo:CUST-1000',
        'shipTo:CUST-1100',
        'billTo:CUST-1000',
        'payer:CUST-1000',
      ]);
      expect(order.partners.shipTo).toEqual({
        customerNumber: 'CUST-1100',
        name: 'Customer CUST-1100',
        street: 'Teststraße 1',
        postalCode: '10115',
        city: 'Berlin',
        country: 'DE',
      });
      expect(
        order.items.map((i) => [
          i.itemNumber,
          i.materialNumber,
          i.materialDescription,
          i.quantity,
          i.unitPrice,
          i.netValue,
        ]),
      ).toEqual([
        [10, 'MAT-001', 'Heat Pump', 2, '4400.00', '8800.00'],
        [20, 'MAT-002', 'Thermostat', 10, '189.50', '1895.00'],
      ]);
      expect(order.items.map((i) => i.conditions)).toEqual([
        [
          {
            stepNumber: 10,
            conditionType: { code: 'ZP03', name: 'Special Price' },
            source: 'SOLD_TO',
            conditionId: specialPriceId,
            amount: '4400.00',
            validFrom: '2026-10-29',
            validTo: null,
            value: '8800.00',
          },
        ],
        [
          {
            stepNumber: 10,
            conditionType: { code: 'ZP02', name: 'Customer Net Price' },
            source: 'SOLD_TO',
            conditionId: soldToPriceId,
            amount: '189.50',
            validFrom: '2026-01-01',
            validTo: null,
            value: '1895.00',
          },
        ],
      ]);

      // The stored document is exactly what was returned
      const read = await http().get('/sales-orders/1000000001').expect(200);
      expect(read.body).toEqual(order);
      expect(await prisma.salesOrderPartner.count()).toBe(4);
      expect(await prisma.salesOrderItem.count()).toBe(2);
      expect(await prisma.salesOrderItemCondition.count()).toBe(2);
    });

    it('changes no master data or price condition', async () => {
      const before = await tableFingerprint(prisma);
      await create(muellerOrder()).expect(201);
      const after = await tableFingerprint(prisma);
      for (const table of MASTER_TABLES) {
        expect(after[table]).toBe(before[table]);
      }
      const special = await prisma.priceCondition.findUniqueOrThrow({
        where: { conditionId: specialPriceId },
      });
      expect([String(special.amount), special.isActive]).toEqual([
        '4400',
        true,
      ]);
    });

    it('keeps the simulation unchanged: 10695.00 EUR, VALID, nothing stored', async () => {
      const before = await tableFingerprint(prisma);
      const {
        requestId: _id,
        expectedTotal: _total,
        items,
        ...header
      } = muellerOrder();
      // The simulation request is unchanged: positions without prices
      const request = {
        ...header,
        pricingDate: '2026-11-15',
        items: items.map(({ materialNumber, quantity }) => ({
          materialNumber,
          quantity,
        })),
      };
      const simulation = await http()
        .post('/sales-orders/simulate')
        .send(request)
        .expect(200);
      expect([simulation.body.status, simulation.body.totals.netValue]).toEqual(
        ['VALID', '10695.00'],
      );
      expect(await tableFingerprint(prisma)).toEqual(before);

      // A confirmed price is not part of the simulation contract
      const withPrice = await http()
        .post('/sales-orders/simulate')
        .send({ ...request, items })
        .expect(400);
      expect(withPrice.body.message).toContain(
        'items.0.property expectedUnitPrice should not exist',
      );
    });

    it('numbers orders ascending with 10 digits', async () => {
      await create(muellerOrder()).expect(201);
      const second = await create(
        muellerOrder({
          unitId: 'UNIT-MUENCHEN',
          items: [item('MAT-001', 2, '4400.00'), item('MAT-002', 10, '179.00')],
          expectedTotal: { netValue: '10590.00', currency: 'EUR' },
        }),
      ).expect(201);
      expect(second.body.salesOrderNumber).toBe('1000000002');
      // München: 2 x 4400.00 (Sold-to ZP03) + 10 x 179.00 (unit ZP02)
      expect(second.body.totals.netValue).toBe('10590.00');
      expect(second.body.partners.shipTo.customerNumber).toBe('CUST-1200');
    });

    it('creates an order with warnings and a delivery block for a customer note', async () => {
      const response = await create(
        muellerOrder({
          customerNote: 'Please deliver to Gate 3.',
          requestedShippingMethod: 'EXPRESS',
          requestedDeliveryDate: '2026-11-30',
          shipToCustomerNumber: 'CUST-1200',
        }),
      ).expect(201);
      expect(response.body).toMatchObject({
        deliveryBlock: 'SALES_REVIEW',
        customerNote: 'Please deliver to Gate 3.',
        requestedShippingMethod: 'EXPRESS',
        requestedDeliveryDate: '2026-11-30',
        partners: { shipTo: { customerNumber: 'CUST-1200' } },
      });
    });

    it('treats a blank note and reference as none', async () => {
      const response = await create(
        muellerOrder({ customerNote: '   ', customerReference: '' }),
      ).expect(201);
      expect([
        response.body.customerNote,
        response.body.customerReference,
        response.body.deliveryBlock,
      ]).toEqual([null, null, null]);
    });
  });

  describe('server order date in the time zone of the sales organization', () => {
    beforeEach(async () => {
      // A unit price for Stuttgart that starts on 2026-11-16
      await prisma.priceCondition.create({
        data: {
          conditionTypeCode: 'ZP02',
          ...GERMANY,
          materialNumber: 'MAT-002',
          scope: 'B2B_UNIT',
          unitId: 'UNIT-STUTTGART',
          amount: '180.00',
          currency: 'EUR',
          validFrom: new Date('2026-11-16T00:00:00Z'),
        },
      });
    });

    it('prices on the German date one millisecond before midnight', async () => {
      clock.set('2026-11-15T22:59:59.999Z'); // 23:59:59.999 in Berlin
      const response = await create(muellerOrder()).expect(201);
      expect([
        response.body.orderDate,
        response.body.items[1].unitPrice,
      ]).toEqual(['2026-11-15', '189.50']);
    });

    it('prices on the next German date at midnight', async () => {
      clock.set('2026-11-15T23:00:00.000Z'); // 00:00 in Berlin
      const response = await create(
        muellerOrder({
          items: [item('MAT-001', 2, '4400.00'), item('MAT-002', 10, '180.00')],
          expectedTotal: { netValue: '10600.00', currency: 'EUR' },
        }),
      ).expect(201);
      expect([
        response.body.orderDate,
        response.body.items[1].unitPrice,
      ]).toEqual(['2026-11-16', '180.00']);
    });

    it('answers PRICE_CHANGED if midnight passed after the simulation', async () => {
      clock.set('2026-11-15T23:00:00.000Z');
      const response = await create(muellerOrder()).expect(409);
      const body = response.body as ErrorBody;
      expect(body.code).toBe('PRICE_CHANGED');
      expect(body.evaluation?.pricingDate).toBe('2026-11-16');
      expect(body.evaluation?.totals?.netValue).toBe('10600.00');
      expect(body.changedItems).toEqual([
        expect.objectContaining({
          itemNumber: 20,
          expectedUnitPrice: '189.50',
          unitPrice: '180.00',
        }),
      ]);
      expect(await orderCount()).toBe(0);
    });

    it('never accepts a date from the client', async () => {
      const response = await create(
        muellerOrder({ pricingDate: '2026-01-01' }),
      ).expect(400);
      expect(response.body.message).toContain(
        'property pricingDate should not exist',
      );
    });

    it('uses the Japanese date for a Japanese order at the same instant', async () => {
      await createJapanData(prisma);
      clock.set('2026-11-15T16:00:00.000Z'); // 17:00 in Berlin, 01:00 on 16 Nov in Tokyo
      const japan = await create({
        requestId: randomUUID(),
        ...JAPAN,
        unitId: 'UNIT-OSAKA',
        items: [item('MAT-001', 2, '700000')],
        expectedTotal: { netValue: '1400000', currency: 'JPY' },
      }).expect(201);
      expect(japan.body).toMatchObject({
        salesArea: JAPAN,
        currency: 'JPY',
        currencyDecimals: 0,
        orderDate: '2026-11-16',
        timeZone: 'Asia/Tokyo',
        items: [{ unitPrice: '700000', netValue: '1400000' }],
        totals: { netValue: '1400000', currency: 'JPY' },
      });
      const germany = await create(muellerOrder()).expect(201);
      expect(germany.body.orderDate).toBe('2026-11-15');
    });
  });

  describe('prices are always determined by the ERP API', () => {
    it('answers PRICE_CHANGED after a price change and stores nothing', async () => {
      await http()
        .patch(`/price-conditions/${soldToPriceId}`)
        .send({ amount: '190.00' })
        .expect(200);
      const response = await create(muellerOrder()).expect(409);
      const body = response.body as ErrorBody;
      expect(body.code).toBe('PRICE_CHANGED');
      expect(body.message).toEqual([
        'The price of item 20 (MAT-002) is now 190.00 EUR instead of the confirmed 189.50 EUR.',
        'The order total is now 10700.00 EUR instead of the confirmed 10695.00 EUR.',
        'Nothing was stored; review the new prices and confirm the order again.',
      ]);
      expect(body.changedItems).toEqual([
        {
          itemNumber: 20,
          materialNumber: 'MAT-002',
          quantity: 10,
          expectedUnitPrice: '189.50',
          unitPrice: '190.00',
        },
      ]);
      expect(body.expectedTotal).toEqual({
        netValue: '10695.00',
        currency: 'EUR',
      });
      expect(body.evaluation?.totals?.netValue).toBe('10700.00');
      expect(await orderCount()).toBe(0);

      // The user confirms the new prices in a new attempt
      const confirmed = await create(
        muellerOrder({
          items: [item('MAT-001', 2, '4400.00'), item('MAT-002', 10, '190.00')],
          expectedTotal: { netValue: '10700.00', currency: 'EUR' },
        }),
      ).expect(201);
      expect(confirmed.body.items[1].unitPrice).toBe('190.00');
      // No number was used up by the rejected attempt
      expect(confirmed.body.salesOrderNumber).toBe('1000000001');
    });

    it('catches price changes in opposite directions that keep the total', async () => {
      // +5.00 x 2 = +10.00 and -1.00 x 10 = -10.00: the total stays 10695.00
      await http()
        .patch(`/price-conditions/${specialPriceId}`)
        .send({ amount: '4405.00' })
        .expect(200);
      await http()
        .patch(`/price-conditions/${soldToPriceId}`)
        .send({ amount: '188.50' })
        .expect(200);

      const response = await create(muellerOrder()).expect(409);
      const body = response.body as ErrorBody;
      expect(body.code).toBe('PRICE_CHANGED');
      expect(body.evaluation?.totals?.netValue).toBe('10695.00');
      expect(body.changedItems).toEqual([
        {
          itemNumber: 10,
          materialNumber: 'MAT-001',
          quantity: 2,
          expectedUnitPrice: '4400.00',
          unitPrice: '4405.00',
        },
        {
          itemNumber: 20,
          materialNumber: 'MAT-002',
          quantity: 10,
          expectedUnitPrice: '189.50',
          unitPrice: '188.50',
        },
      ]);
      expect(await orderCount()).toBe(0);
    });

    it('compares reordered positions with their own confirmed prices', async () => {
      // Positions reordered, each with its correct price: accepted
      const reordered = await create(
        muellerOrder({
          items: [item('MAT-002', 10, '189.50'), item('MAT-001', 2, '4400.00')],
        }),
      ).expect(201);
      expect(
        reordered.body.items.map(
          (i: { itemNumber: number; materialNumber: string }) =>
            `${i.itemNumber}:${i.materialNumber}`,
        ),
      ).toEqual(['10:MAT-002', '20:MAT-001']);

      // Positions reordered, but the prices left in the old order: rejected
      const mixedUp = await create(
        muellerOrder({
          items: [item('MAT-002', 10, '4400.00'), item('MAT-001', 2, '189.50')],
        }),
      ).expect(409);
      expect(
        (mixedUp.body as ErrorBody).changedItems?.map((i) => i.itemNumber),
      ).toEqual([10, 20]);
      expect(await orderCount()).toBe(1);
    });

    it('compares each position of the same material separately', async () => {
      const both = await create(
        muellerOrder({
          items: [item('MAT-002', 1, '189.50'), item('MAT-002', 2, '189.50')],
          expectedTotal: { netValue: '568.50', currency: 'EUR' },
        }),
      ).expect(201);
      expect(
        both.body.items.map((i: { netValue: string }) => i.netValue),
      ).toEqual(['189.50', '379.00']);

      const oneWrong = await create(
        muellerOrder({
          items: [item('MAT-002', 1, '189.50'), item('MAT-002', 2, '189.51')],
          expectedTotal: { netValue: '568.50', currency: 'EUR' },
        }),
      ).expect(409);
      expect((oneWrong.body as ErrorBody).changedItems).toEqual([
        {
          itemNumber: 20,
          materialNumber: 'MAT-002',
          quantity: 2,
          expectedUnitPrice: '189.51',
          unitPrice: '189.50',
        },
      ]);
    });

    it('accepts unchanged prices in any decimal notation', async () => {
      await create(
        muellerOrder({
          items: [item('MAT-001', 2, '4400'), item('MAT-002', 10, '189.5')],
          expectedTotal: { netValue: '10695', currency: 'EUR' },
        }),
      ).expect(201);
    });

    it.each([
      ['a missing price', { materialNumber: 'MAT-001', quantity: 2 }],
      [
        'a numeric price',
        { materialNumber: 'MAT-001', quantity: 2, expectedUnitPrice: 4400 },
      ],
      ['three decimals', item('MAT-001', 2, '4400.001')],
      ['a negative price', item('MAT-001', 2, '-4400.00')],
      ['an exponent', item('MAT-001', 2, '4.4e3')],
    ])('rejects %s with 400', async (_case, first) => {
      const response = await create(
        muellerOrder({ items: [first, item('MAT-002', 10, '189.50')] }),
      ).expect(400);
      expect(response.body.message).toContain(
        'items.0.expectedUnitPrice must be a decimal string with at most two decimal places, e.g. "189.50"',
      );
      expect(await orderCount()).toBe(0);
    });

    it('never stores a total the client wishes for', async () => {
      const response = await create(
        muellerOrder({ expectedTotal: { netValue: '1.00', currency: 'EUR' } }),
      ).expect(409);
      expect(response.body.code).toBe('PRICE_CHANGED');
      const wrongCurrency = await create(
        muellerOrder({
          expectedTotal: { netValue: '10695.00', currency: 'PLN' },
        }),
      ).expect(409);
      expect(wrongCurrency.body.code).toBe('PRICE_CHANGED');
      expect(await orderCount()).toBe(0);
    });

    it('rejects price fields from the client', async () => {
      const response = await create(
        muellerOrder({
          items: [{ ...item('MAT-001', 2, '4400.00'), unitPrice: '1.00' }],
        }),
      ).expect(400);
      expect(response.body.message).toContain(
        'items.0.property unitPrice should not exist',
      );
      expect(await orderCount()).toBe(0);
    });
  });

  describe('orders with errors are not created (422 ORDER_INVALID)', () => {
    const expectInvalid = async (body: object, code: string) => {
      const response = await create(body).expect(422);
      const error = response.body as ErrorBody;
      expect(error.code).toBe('ORDER_INVALID');
      expect(error.evaluation?.status).toBe('INVALID');
      const codes = [
        ...(error.evaluation?.messages ?? []),
        ...(error.evaluation?.items.flatMap((i) => i.messages) ?? []),
      ].map((m) => m.code);
      expect(codes).toContain(code);
      expect(await orderCount()).toBe(0);
      return error;
    };

    it('rejects an item without a price, even if other items have one', async () => {
      // MAT-PL only has a Polish list price
      await expectInvalid(
        muellerOrder({
          items: [item('MAT-001', 1, '4400.00'), item('MAT-PL', 1, '99.00')],
        }),
        'NO_PRICE_FOUND',
      );
    });

    it('rejects an unknown material', async () => {
      await expectInvalid(
        muellerOrder({ items: [item('MAT-404', 1, '1.00')] }),
        'MATERIAL_NOT_FOUND',
      );
    });

    it('rejects an inactive unit', async () => {
      await prisma.b2bUnit.update({
        where: { unitId: 'UNIT-STUTTGART' },
        data: { isActive: false },
      });
      await expectInvalid(muellerOrder(), 'MASTER_DATA_INACTIVE');
    });

    it('rejects an inactive partner (Ship-to)', async () => {
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1100' },
        data: { isActive: false },
      });
      await expectInvalid(muellerOrder(), 'MASTER_DATA_INACTIVE');
    });

    it('rejects a Ship-to that is not allowed for the unit', async () => {
      await expectInvalid(
        muellerOrder({ shipToCustomerNumber: 'CUST-2000' }),
        'SHIP_TO_NOT_ALLOWED',
      );
    });

    it('rejects a unit of another market', async () => {
      await expectInvalid(muellerOrder({ ...JAPAN }), 'UNIT_NOT_IN_SALES_AREA');
    });

    it('rejects an unknown sales area', async () => {
      await expectInvalid(
        muellerOrder({ salesOrganization: '9999' }),
        'SALES_AREA_NOT_FOUND',
      );
    });

    it('rejects a requested delivery date before the server order date', async () => {
      await expectInvalid(
        muellerOrder({ requestedDeliveryDate: '2026-11-14' }),
        'REQUESTED_DELIVERY_DATE_BEFORE_ORDER_DATE',
      );
    });

    it('rejects malformed requests with 400', async () => {
      const { requestId: _id, ...withoutId } = muellerOrder();
      expect((await create(withoutId).expect(400)).body.message).toContain(
        'requestId must be a UUID',
      );
      expect(
        (await create(muellerOrder({ items: [] })).expect(400)).body.message,
      ).toContain('items must contain at least 1 elements');
    });
  });

  describe('stored documents never change (snapshots)', () => {
    it('keeps the order when master data and prices change later', async () => {
      const created = (await create(muellerOrder()).expect(201)).body as Order;

      await http()
        .patch('/customers/CUST-1000')
        .send({
          name: 'Renamed GmbH',
          street: 'Neue Straße 1',
          city: 'Hamburg',
        })
        .expect(200);
      await http()
        .patch('/customers/CUST-1100')
        .send({ name: 'Renamed Warehouse' })
        .expect(200);
      await http()
        .patch('/materials/MAT-001')
        .send({ description: 'Heat Pump XL' })
        .expect(200);
      await http()
        .patch(`/price-conditions/${specialPriceId}`)
        .send({ amount: '3999.00' })
        .expect(200);
      await http()
        .patch(`/price-conditions/${soldToPriceId}`)
        .send({ isActive: false })
        .expect(200);
      await http()
        .patch('/b2b-units/UNIT-STUTTGART')
        .send({ name: 'Stuttgart (new)' })
        .expect(200);

      const read = await http()
        .get(`/sales-orders/${created.salesOrderNumber}`)
        .expect(200);
      expect(read.body).toEqual(created);
    });

    it('does not block master data maintenance', async () => {
      const created = (await create(muellerOrder()).expect(201)).body as Order;
      // The Ship-to of the order is removed from the unit, the unit is deactivated
      await http()
        .patch('/b2b-units/UNIT-STUTTGART')
        .send({
          shipToCustomerNumbers: ['CUST-1000', 'CUST-1200'],
          defaultShipToCustomerNumber: 'CUST-1200',
        })
        .expect(200);
      await http()
        .patch('/b2b-units/UNIT-STUTTGART')
        .send({ isActive: false })
        .expect(200);
      await http()
        .patch('/customers/CUST-1100')
        .send({ isActive: false })
        .expect(200);

      const read = await http()
        .get(`/sales-orders/${created.salesOrderNumber}`)
        .expect(200);
      expect(read.body).toEqual(created);
    });
  });

  describe('idempotency', () => {
    it('returns the existing order for a repeated request without pricing it again', async () => {
      const body = muellerOrder();
      const first = await create(body).expect(201);
      // A price changes before the retry arrives
      await http()
        .patch(`/price-conditions/${soldToPriceId}`)
        .send({ amount: '190.00' })
        .expect(200);

      const retry = await create(body).expect(200);
      expect(retry.headers.location).toBe(
        `/sales-orders/${first.body.salesOrderNumber}`,
      );
      expect(retry.body).toEqual(first.body);
      expect(await orderCount()).toBe(1);
    });

    it('treats the same data written differently as the same request', async () => {
      const body = muellerOrder({ customerNote: null });
      await create(body).expect(201);
      await create({
        ...body,
        customerNote: '  ',
        requestedShippingMethod: 'STANDARD',
        items: [item('MAT-001', 2, '4400'), item('MAT-002', 10, '189.5')],
        expectedTotal: { netValue: '10695', currency: 'EUR' },
      }).expect(200);
      expect(await orderCount()).toBe(1);
    });

    it('rejects a reused requestId with different confirmed prices', async () => {
      const body = muellerOrder();
      await create(body).expect(201);
      const response = await create({
        ...body,
        items: [item('MAT-001', 2, '4405.00'), item('MAT-002', 10, '188.50')],
      }).expect(409);
      expect(response.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await orderCount()).toBe(1);
    });

    it('rejects a reused requestId with different data', async () => {
      const body = muellerOrder();
      const first = await create(body).expect(201);
      const response = await create({
        ...body,
        items: [item('MAT-001', 3, '4400.00')],
        expectedTotal: { netValue: '13200.00', currency: 'EUR' },
      }).expect(409);
      expect(response.body).toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
        salesOrderNumber: first.body.salesOrderNumber,
      });
      expect(await orderCount()).toBe(1);
    });

    it('does not reserve the requestId of a rejected attempt', async () => {
      const body = muellerOrder({
        expectedTotal: { netValue: '1.00', currency: 'EUR' },
      });
      await create(body).expect(409);
      // Nothing was stored for it, so the ID is still free (the Backoffice
      // nevertheless uses a new ID for every new confirmation)
      await create({
        ...body,
        expectedTotal: { netValue: '10695.00', currency: 'EUR' },
      }).expect(201);
    });
  });

  describe('concurrency', () => {
    it('creates exactly one order for parallel requests with the same requestId', async () => {
      const body = muellerOrder();
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => create(body)),
      );
      const statuses = responses.map((r) => r.status).sort((x, y) => x - y);
      expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
      expect(new Set(responses.map((r) => r.body.salesOrderNumber)).size).toBe(
        1,
      );
      expect(await orderCount()).toBe(1);
    });

    it('creates separate orders with unique numbers for parallel different requests', async () => {
      const responses = await Promise.all(
        Array.from({ length: 6 }, () => create(muellerOrder())),
      );
      expect(responses.map((r) => r.status)).toEqual([
        201, 201, 201, 201, 201, 201,
      ]);
      const numbers = responses
        .map((r) => r.body.salesOrderNumber as string)
        .sort();
      expect(numbers).toEqual([
        '1000000001',
        '1000000002',
        '1000000003',
        '1000000004',
        '1000000005',
        '1000000006',
      ]);
    });

    /**
     * Starts a transaction that changes data and keeps its locks until
     * release() is called, like a slow concurrent writer.
     */
    async function holdWriter(
      work: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) {
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let ready!: () => void;
      const isReady = new Promise<void>((resolve) => (ready = resolve));
      const done = prisma.$transaction(
        async (tx) => {
          await work(tx);
          ready();
          await released;
        },
        { timeout: 20_000 },
      );
      await isReady;
      return { release, done };
    }

    /** Waits until a session of this database waits for a lock */
    async function waitForLockWait() {
      for (let i = 0; i < 100; i++) {
        const [{ waiting }] = await prisma.$queryRaw<{ waiting: bigint }[]>`
          SELECT count(*) AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`;
        if (waiting > 0n) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('No session waited for a lock');
    }

    it('waits for a concurrent price change and then uses the committed price', async () => {
      // Like PATCH /price-conditions: lock the material, change the price
      const writer = await holdWriter(async (tx) => {
        await tx.$queryRaw`SELECT material_number FROM materials WHERE material_number = 'MAT-002' FOR UPDATE`;
        await tx.priceCondition.update({
          where: { conditionId: soldToPriceId },
          data: { amount: '190.00' },
        });
      });
      const pending = create(muellerOrder()).then((r) => r);
      await waitForLockWait();
      writer.release();
      await writer.done;

      const response = await pending;
      // The order saw the new price and did not silently store another total
      expect([
        response.status,
        response.body.code,
        response.body.evaluation.totals.netValue,
      ]).toEqual([409, 'PRICE_CHANGED', '10700.00']);
      expect(await orderCount()).toBe(0);
    });

    it('waits for a concurrent unit deactivation and then rejects the order', async () => {
      const writer = await holdWriter(async (tx) => {
        await tx.$queryRaw`SELECT unit_id FROM b2b_units WHERE unit_id = 'UNIT-STUTTGART' FOR UPDATE`;
        await tx.b2bUnit.update({
          where: { unitId: 'UNIT-STUTTGART' },
          data: { isActive: false },
        });
      });
      const pending = create(muellerOrder()).then((r) => r);
      await waitForLockWait();
      writer.release();
      await writer.done;

      const response = await pending;
      expect([response.status, response.body.code]).toEqual([
        422,
        'ORDER_INVALID',
      ]);
      expect(await orderCount()).toBe(0);
    });

    it('waits for a concurrent partner change and stores the committed address', async () => {
      const writer = await holdWriter((tx) =>
        tx.customer.update({
          where: { customerNumber: 'CUST-1000' },
          data: { name: 'Müller Heiztechnik AG' },
        }),
      );
      const pending = create(muellerOrder()).then((r) => r);
      await waitForLockWait();
      writer.release();
      await writer.done;

      const response = await pending;
      expect(response.status).toBe(201);
      expect(response.body.partners.soldTo.name).toBe('Müller Heiztechnik AG');
    });

    it('makes a concurrent price change wait until the order is stored', async () => {
      // The order holds its locks while it is created; a price change of a
      // material in the order cannot slip in between reading and storing
      const order = await holdWriter(async (tx) => {
        await tx.$queryRaw`SELECT material_number FROM materials WHERE material_number = 'MAT-002' FOR SHARE`;
      });
      const change = http()
        .patch(`/price-conditions/${soldToPriceId}`)
        .send({ amount: '190.00' })
        .then((r) => r);
      await waitForLockWait();
      const amountWhileLocked = await prisma.priceCondition.findUniqueOrThrow({
        where: { conditionId: soldToPriceId },
      });
      expect(String(amountWhileLocked.amount)).toBe('189.5');
      order.release();
      await order.done;
      expect((await change).status).toBe(200);
    });
  });

  describe('reading orders', () => {
    it('answers 404 for an unknown or malformed number', async () => {
      expect(
        (await http().get('/sales-orders/1000009999').expect(404)).body.message,
      ).toBe('Sales order 1000009999 not found');
      expect(
        (await http().get('/sales-orders/12345').expect(404)).body.message,
      ).toBe('Sales order 12345 not found');
      // As before this route existed
      await http().get('/sales-orders/simulate').expect(404);
      await http().get('/sales-orders').expect(404);
    });
  });

  describe('database safeguards', () => {
    let number: string;
    beforeEach(async () => {
      number = (
        await create(muellerOrder({ customerNote: 'Gate 3' })).expect(201)
      ).body.salesOrderNumber;
    });

    it.each([
      [
        'an item price',
        `UPDATE sales_order_items SET unit_price = 1 WHERE item_number = 10`,
      ],
      ['an item', `DELETE FROM sales_order_items WHERE item_number = 20`],
      [
        'a partner address',
        `UPDATE sales_order_partners SET city = 'Elsewhere'`,
      ],
      [
        'an applied condition',
        `UPDATE sales_order_item_conditions SET amount = 1`,
      ],
      ['the header total', `UPDATE sales_orders SET net_value = 1`],
      ['the header currency', `UPDATE sales_orders SET currency_decimals = 0`],
      ['the order date', `UPDATE sales_orders SET order_date = order_date + 1`],
      ['an order', `DELETE FROM sales_orders`],
    ])('rejects changing %s (trigger)', async (_what, sql) => {
      // Fixed statements, never user input
      await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow(
        /cannot be changed or deleted|cannot be deleted|Only status and delivery block/,
      );
      expect(
        (await http().get(`/sales-orders/${number}`).expect(200)).body.totals
          .netValue,
      ).toBe('10695.00');
    });

    it('allows changing only the status fields of the header', async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE sales_orders SET delivery_block = NULL, updated_at = now()`,
      );
      expect(
        (await http().get(`/sales-orders/${number}`).expect(200)).body
          .deliveryBlock,
      ).toBeNull();
    });

    const header = (change: Record<string, string>) => {
      const values: Record<string, string> = {
        sales_order_number: `'1000000999'`,
        request_id: `'${randomUUID()}'`,
        request_hash: `'${'a'.repeat(64)}'`,
        sales_organization: `'1000'`,
        distribution_channel: `'10'`,
        division: `'00'`,
        currency: `'EUR'`,
        currency_decimals: '2',
        order_date: `'2026-11-15'`,
        time_zone: `'Europe/Berlin'`,
        requested_delivery_date: 'NULL',
        requested_shipping_method: `'STANDARD'`,
        unit_id: `'UNIT-STUTTGART'`,
        unit_name: `'Test'`,
        net_value: '1',
        updated_at: 'now()',
        ...change,
      };
      return `INSERT INTO sales_orders (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`;
    };

    it('accepts a correct header (control for the cases below)', async () => {
      await expect(prisma.$executeRawUnsafe(header({}))).resolves.toBe(1);
    });

    it.each([
      [
        'a unit of another sales area',
        {
          sales_organization: `'3000'`,
          currency: `'JPY'`,
          currency_decimals: '0',
        },
        'sales_orders_unit_fkey',
      ],
      [
        'a currency that is not the currency of the sales organization',
        { currency: `'PLN'` },
        'sales_orders_currency_fkey',
      ],
      [
        'an unknown sales area',
        { distribution_channel: `'99'` },
        'sales_orders_sales_area_fkey',
      ],
      [
        'a reused request ID',
        { request_id: '(SELECT request_id FROM sales_orders LIMIT 1)' },
        'sales_orders_request_id_key',
      ],
      [
        'a malformed order number',
        { sales_order_number: `'SO-1'` },
        'sales_orders_number_check',
      ],
      [
        'a net value with more decimals than the currency',
        { net_value: '1.5', currency_decimals: '0' },
        'sales_orders_net_value_check',
      ],
      [
        'a requested delivery date before the order date',
        { requested_delivery_date: `'2026-11-14'` },
        'sales_orders_requested_delivery_date_check',
      ],
      ['a blank unit name', { unit_name: `'  '` }, 'sales_orders_texts_check'],
    ])('rejects a header with %s', async (_case, change, constraint) => {
      await expect(prisma.$executeRawUnsafe(header(change))).rejects.toThrow(
        constraint,
      );
    });

    it.each([
      [
        'a net value that is not quantity x price',
        `30, 'MAT-001', 'x', 2, 10, 21`,
        'sales_order_items_amounts_check',
      ],
      [
        'quantity 0',
        `30, 'MAT-001', 'x', 0, 10, 0`,
        'sales_order_items_quantity_check',
      ],
      [
        'an item number that is not a multiple of 10',
        `35, 'MAT-001', 'x', 1, 10, 10`,
        'sales_order_items_item_number_check',
      ],
      [
        'an unknown material',
        `30, 'MAT-404', 'x', 1, 10, 10`,
        'sales_order_items_material_fkey',
      ],
    ])('rejects an item with %s', async (_case, values, constraint) => {
      const sql = `INSERT INTO sales_order_items (sales_order_number, item_number, material_number, material_description, quantity, unit_price, net_value) VALUES ('${number}', ${values})`;
      await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow(constraint);
    });

    it('rejects an applied condition of another sales area or material', async () => {
      // A valid extra item (the triggers only block UPDATE and DELETE)
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO sales_order_items (sales_order_number, item_number, material_number, material_description, quantity, unit_price, net_value) VALUES ('${number}', 30, 'MAT-PL', 'x', 1, 99, 99)`,
        ),
      ).resolves.toBe(1);
      const condition = (
        conditionId: number,
        materialNumber: string,
        type: string,
        scope: string,
      ) =>
        `INSERT INTO sales_order_item_conditions (sales_order_number, item_number, step_number, sales_organization, distribution_channel, division, material_number, condition_id, condition_type_code, condition_type_name, scope, amount, valid_from, condition_value)
         VALUES ('${number}', 30, 10, '1000', '10', '00', '${materialNumber}', ${conditionId}, '${type}', 'x', '${scope}', 99, '2026-01-01', 99)`;
      const fk = 'sales_order_item_conditions_price_condition_fkey';
      // 9003 is the Polish list price of MAT-PL: wrong sales area
      await expect(
        prisma.$executeRawUnsafe(
          condition(9003, 'MAT-PL', 'ZP01', 'SALES_AREA'),
        ),
      ).rejects.toThrow(fk);
      // 9001 is the German list price of MAT-001, not of MAT-PL
      await expect(
        prisma.$executeRawUnsafe(
          condition(9001, 'MAT-PL', 'ZP01', 'SALES_AREA'),
        ),
      ).rejects.toThrow(fk);
      // A condition of MAT-001 on item 30 (MAT-PL)
      await expect(
        prisma.$executeRawUnsafe(
          condition(9001, 'MAT-001', 'ZP01', 'SALES_AREA'),
        ),
      ).rejects.toThrow('sales_order_item_conditions_item_fkey');
    });

    it('keeps referenced master data from being deleted', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM price_conditions WHERE condition_id = ${specialPriceId}`,
        ),
      ).rejects.toThrow('sales_order_item_conditions_price_condition_fkey');
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM customers WHERE customer_number = 'CUST-1100'`,
        ),
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(`DELETE FROM sales_order_partners`),
      ).rejects.toThrow('cannot be changed or deleted');
    });
  });
});

/** A Japanese customer with unit UNIT-OSAKA and a JPY list price of MAT-001 */
async function createJapanData(prisma: PrismaService) {
  await prisma.customer.create({
    data: {
      customerNumber: 'JP-1000',
      name: 'Osaka Heating KK',
      street: '1-1 Umeda',
      postalCode: '530-0001',
      city: 'Osaka',
      country: 'JP',
    },
  });
  await prisma.customerSalesArea.create({
    data: { customerNumber: 'JP-1000', ...JAPAN },
  });
  await prisma.customerAccountMember.create({
    data: membership('JP-1000', 'JP-1000'),
  });
  await prisma.b2bUnit.create({
    data: {
      unitId: 'UNIT-OSAKA',
      name: 'Osaka',
      accountCustomerNumber: 'JP-1000',
      soldToCustomerNumber: 'JP-1000',
      billToCustomerNumber: 'JP-1000',
      payerCustomerNumber: 'JP-1000',
      ...JAPAN,
    },
  });
  await prisma.b2bUnitShipTo.create({
    data: {
      unitId: 'UNIT-OSAKA',
      customerNumber: 'JP-1000',
      accountCustomerNumber: 'JP-1000',
      isDefault: true,
      ...JAPAN,
    },
  });
  await createListPrices(prisma, JAPAN, 'JPY', [['MAT-001', '700000']], 9100);
}
