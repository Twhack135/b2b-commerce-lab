import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createMuellerData,
  createTestApp,
  resetDatabase,
  tableFingerprint,
} from './helpers';

type Message = { severity: string; code: string; text: string; field?: string };
type Item = {
  itemNumber: number;
  materialNumber: string;
  quantity: number;
  unitPrice: string | null;
  netValue: string | null;
  currency: string | null;
  pricing: {
    source: string;
    conditionId: number | null;
    steps: { source: string; applied: boolean }[];
  } | null;
  messages: Message[];
};
type Simulation = {
  status: string;
  partners: Record<
    string,
    { customerNumber?: string; unitId?: string; isDefault?: boolean } | null
  > | null;
  items: Item[];
  totals: { netValue: string; currency: string; includes: string } | null;
  requiresSalesReview: boolean;
  proposedOrderBlock: { type: string; code: string; reason: string } | null;
  customerNote: string | null;
  customerReference: string | null;
  requestedShippingMethod: string;
  checks: { check: string; result: string }[];
  messages: Message[];
};

// The example order of Müller Heiztechnik, Stuttgart branch
const muellerOrder = {
  unitId: 'UNIT-STUTTGART',
  pricingDate: '2026-11-15',
  customerReference: 'PO-STR-2026-118',
  items: [
    { materialNumber: 'MAT-001', quantity: 2 },
    { materialNumber: 'MAT-002', quantity: 10 },
  ],
};

describe('Sales order simulation API', () => {
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
  });

  const simulate = async (body: object) => {
    const response = await http()
      .post('/sales-orders/simulate')
      .send(body)
      .expect(200);
    return response.body as Simulation;
  };
  const codes = (messages: Message[]) => messages.map((m) => m.code);

  describe('standard process', () => {
    it('simulates the Müller order: partners, prices and exact total', async () => {
      const result = await simulate(muellerOrder);

      expect(result.status).toBe('VALID');
      expect(result.partners).toMatchObject({
        unit: { unitId: 'UNIT-STUTTGART' },
        account: { customerNumber: 'CUST-1000' },
        soldTo: { customerNumber: 'CUST-1000' },
        billTo: { customerNumber: 'CUST-1000' },
        payer: { customerNumber: 'CUST-1000' },
        shipTo: { customerNumber: 'CUST-1100', isDefault: true },
      });
      expect(
        result.items.map((i) => [
          i.itemNumber,
          i.materialNumber,
          i.quantity,
          i.unitPrice,
          i.netValue,
          i.pricing?.source,
        ]),
      ).toEqual([
        [10, 'MAT-001', 2, '4500.00', '9000.00', 'BASE_PRICE'],
        [20, 'MAT-002', 10, '189.50', '1895.00', 'SOLD_TO'],
      ]);
      expect(result.totals).toEqual({
        netValue: '10895.00',
        currency: 'EUR',
        includes: 'NET_EXCL_TAX_AND_FREIGHT',
      });
      expect(result).toMatchObject({
        customerReference: 'PO-STR-2026-118',
        customerNote: null,
        requestedShippingMethod: 'STANDARD',
        requiresSalesReview: false,
        proposedOrderBlock: null,
        messages: [],
      });
    });

    it('marks every check that is not part of the simulation', async () => {
      const result = await simulate(muellerOrder);

      expect(
        result.checks
          .filter((c) => c.result === 'NOT_PERFORMED')
          .map((c) => c.check),
      ).toEqual([
        'AVAILABILITY',
        'DELIVERY_DATE',
        'FREIGHT',
        'TAX',
        'CREDIT',
        'CUSTOMER_BLOCKS',
        'MINIMUM_ORDER_VALUE',
      ]);
      expect(
        result.checks.filter((c) => c.result === 'PASSED').map((c) => c.check),
      ).toEqual(['PARTNERS', 'MATERIALS', 'PRICING', 'CURRENCY']);
    });

    it('uses another allowed Ship-to of the unit', async () => {
      const result = await simulate({
        ...muellerOrder,
        shipToCustomerNumber: 'CUST-1200',
      });

      expect(result.status).toBe('VALID');
      expect(result.partners?.shipTo).toMatchObject({
        customerNumber: 'CUST-1200',
        isDefault: false,
      });
    });
  });

  describe('price condition priority', () => {
    it('uses the unit price in München and the Sold-to price in Stuttgart', async () => {
      const order = {
        ...muellerOrder,
        items: [{ materialNumber: 'MAT-002', quantity: 10 }],
      };

      const muenchen = await simulate({ ...order, unitId: 'UNIT-MUENCHEN' });
      const stuttgart = await simulate(order);

      expect(muenchen.items[0]).toMatchObject({
        unitPrice: '179.00',
        netValue: '1790.00',
      });
      expect(muenchen.items[0].pricing?.source).toBe('B2B_UNIT');
      expect(
        muenchen.items[0].pricing?.steps.map((s) => `${s.source}:${s.applied}`),
      ).toEqual(['B2B_UNIT:true', 'SOLD_TO:false', 'BASE_PRICE:false']);
      expect(stuttgart.items[0]).toMatchObject({
        unitPrice: '189.50',
        netValue: '1895.00',
      });
    });

    it('uses the price valid on the pricing date', async () => {
      const order = {
        ...muellerOrder,
        unitId: 'UNIT-MUENCHEN',
        items: [{ materialNumber: 'MAT-002', quantity: 1 }],
      };

      const results = await Promise.all(
        ['2025-12-31', '2026-06-14', '2026-06-15'].map((pricingDate) =>
          simulate({ ...order, pricingDate }),
        ),
      );

      expect(
        results.map(
          (r) => `${r.items[0].pricing?.source} ${r.items[0].unitPrice}`,
        ),
      ).toEqual(['BASE_PRICE 199.00', 'SOLD_TO 189.50', 'B2B_UNIT 179.00']);
    });
  });

  describe('same material in several positions', () => {
    it('keeps and prices every position separately with an INFO', async () => {
      const result = await simulate({
        ...muellerOrder,
        items: [
          { materialNumber: 'MAT-002', quantity: 10 },
          { materialNumber: 'MAT-001', quantity: 2 },
          { materialNumber: 'MAT-002', quantity: 5 },
        ],
      });

      expect(result.status).toBe('VALID');
      expect(
        result.items.map((i) => [
          i.itemNumber,
          i.materialNumber,
          i.quantity,
          i.netValue,
        ]),
      ).toEqual([
        [10, 'MAT-002', 10, '1895.00'],
        [20, 'MAT-001', 2, '9000.00'],
        [30, 'MAT-002', 5, '947.50'],
      ]);
      expect(result.totals?.netValue).toBe('11842.50');
      expect(result.messages).toEqual([
        {
          severity: 'INFO',
          code: 'SAME_MATERIAL_IN_SEVERAL_ITEMS',
          text: 'Material MAT-002 appears in items 10 and 30. Each item is kept and priced separately.',
        },
      ]);
    });
  });

  describe('customer note and proposed delivery block', () => {
    it('returns a warning and a proposed block, but no error', async () => {
      const result = await simulate({
        ...muellerOrder,
        customerNote:
          'Bitte nur über Tor 3 anliefern. Ansprechpartner: Hr. Weber',
      });

      expect(result).toMatchObject({
        status: 'VALID_WITH_WARNINGS',
        customerNote:
          'Bitte nur über Tor 3 anliefern. Ansprechpartner: Hr. Weber',
        requiresSalesReview: true,
        proposedOrderBlock: {
          type: 'DELIVERY_BLOCK',
          code: 'SALES_REVIEW',
          reason: 'CUSTOMER_NOTE',
        },
        totals: { netValue: '10895.00' },
      });
      expect(result.messages).toEqual([
        expect.objectContaining({
          severity: 'WARNING',
          code: 'SALES_REVIEW_REQUIRED',
          field: 'customerNote',
        }),
      ]);
    });

    it.each(['', '   ', '\n\t\r\n '])(
      'treats %p as no note',
      async (customerNote) => {
        const result = await simulate({ ...muellerOrder, customerNote });

        expect(result).toMatchObject({
          status: 'VALID',
          customerNote: null,
          requiresSalesReview: false,
          proposedOrderBlock: null,
        });
      },
    );

    it('accepts a note of 1000 characters and rejects 1001', async () => {
      await simulate({ ...muellerOrder, customerNote: 'N'.repeat(1000) });
      await http()
        .post('/sales-orders/simulate')
        .send({ ...muellerOrder, customerNote: 'N'.repeat(1001) })
        .expect(400);
    });
  });

  describe('requested shipping method', () => {
    it('only informs about Express', async () => {
      const result = await simulate({
        ...muellerOrder,
        requestedShippingMethod: 'EXPRESS',
      });

      expect(result.status).toBe('VALID');
      expect(result.requestedShippingMethod).toBe('EXPRESS');
      expect(codes(result.messages)).toEqual(['EXPRESS_REQUESTED']);
      expect(result.totals?.netValue).toBe('10895.00');
    });
  });

  describe('inactive and unauthorized partners', () => {
    it('rejects an inactive default Ship-to, still showing prices but no total', async () => {
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1100' },
        data: { isActive: false },
      });

      const result = await simulate(muellerOrder);

      expect(result.status).toBe('INVALID');
      expect(result.messages).toEqual([
        expect.objectContaining({
          code: 'MASTER_DATA_INACTIVE',
          field: 'shipTo',
        }),
      ]);
      expect(result.items.map((i) => i.netValue)).toEqual([
        '9000.00',
        '1895.00',
      ]);
      expect(result.totals).toBeNull();
      expect(result.checks[0]).toEqual({ check: 'PARTNERS', result: 'FAILED' });
    });

    it('rejects an inactive Bill-to with its role', async () => {
      await prisma.b2bUnit.update({
        where: { unitId: 'UNIT-STUTTGART' },
        data: { billToCustomerNumber: 'CUST-1200' },
      });
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1200' },
        data: { isActive: false },
      });

      const result = await simulate(muellerOrder);

      expect(result.status).toBe('INVALID');
      expect(result.messages.map((m) => [m.code, m.field])).toEqual([
        ['MASTER_DATA_INACTIVE', 'billTo'],
      ]);
    });

    it('rejects an inactive Sold-to in all its roles', async () => {
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: false },
      });

      const result = await simulate(muellerOrder);

      expect(result.messages.map((m) => m.field)).toEqual([
        'account',
        'soldTo',
        'billTo',
        'payer',
      ]);
    });

    it('rejects an inactive unit', async () => {
      await prisma.b2bUnit.update({
        where: { unitId: 'UNIT-STUTTGART' },
        data: { isActive: false },
      });

      const result = await simulate(muellerOrder);

      expect(result.messages.map((m) => [m.code, m.field])).toEqual([
        ['MASTER_DATA_INACTIVE', 'unitId'],
      ]);
    });

    it.each([
      ['a customer of another account', 'CUST-2000'],
      ['an account member that is no Ship-to of this unit', 'CUST-1000'],
      ['an unknown customer', 'NOPE'],
    ])('rejects %s as Ship-to', async (_case, shipToCustomerNumber) => {
      const result = await simulate({
        ...muellerOrder,
        unitId: 'UNIT-MUENCHEN',
        shipToCustomerNumber,
      });

      expect(result.status).toBe('INVALID');
      expect(codes(result.messages)).toEqual(['SHIP_TO_NOT_ALLOWED']);
      expect(result.partners?.shipTo).toBeNull();
    });

    it('reports an unknown unit without partners or prices', async () => {
      const result = await simulate({ ...muellerOrder, unitId: 'NOPE' });

      expect(result.status).toBe('INVALID');
      expect(result.partners).toBeNull();
      expect(result.items.map((i) => i.unitPrice)).toEqual([null, null]);
      expect(codes(result.messages)).toEqual(['UNIT_NOT_FOUND']);
    });

    it.each([
      'soldToCustomerNumber',
      'billToCustomerNumber',
      'payerCustomerNumber',
    ])('does not accept %s from the request', async (field) => {
      await http()
        .post('/sales-orders/simulate')
        .send({ ...muellerOrder, [field]: 'CUST-2000' })
        .expect(400);
    });
  });

  describe('materials and currencies', () => {
    it('reports an unknown material at its position and prices the others', async () => {
      const result = await simulate({
        ...muellerOrder,
        items: [
          { materialNumber: 'MAT-001', quantity: 2 },
          { materialNumber: 'MAT-999', quantity: 1 },
        ],
      });

      expect(result.status).toBe('INVALID');
      expect(result.items[0].netValue).toBe('9000.00');
      expect(result.items[1]).toMatchObject({
        itemNumber: 20,
        unitPrice: null,
        messages: [
          {
            severity: 'ERROR',
            code: 'MATERIAL_NOT_FOUND',
            field: 'materialNumber',
          },
        ],
      });
      expect(result.messages).toEqual([]);
      expect(result.totals).toBeNull();
    });

    it('rejects mixed currencies', async () => {
      const result = await simulate({
        ...muellerOrder,
        items: [
          { materialNumber: 'MAT-001', quantity: 2 },
          { materialNumber: 'MAT-CH', quantity: 4 },
        ],
      });

      expect(result.status).toBe('INVALID');
      expect(codes(result.messages)).toEqual(['MIXED_CURRENCIES']);
      expect(result.items.map((i) => `${i.netValue} ${i.currency}`)).toEqual([
        '9000.00 EUR',
        '100.00 CHF',
      ]);
      expect(result.totals).toBeNull();
    });
  });

  describe('exact decimals', () => {
    it('sums 200 positions of 0.10 x 3 exactly', async () => {
      await prisma.material.createMany({
        data: Array.from({ length: 200 }, (_, i) => ({
          materialNumber: `SMALL-${i}`,
          description: 'Washer',
          price: '0.10',
          currency: 'EUR',
        })),
      });

      const result = await simulate({
        ...muellerOrder,
        items: Array.from({ length: 200 }, (_, i) => ({
          materialNumber: `SMALL-${i}`,
          quantity: 3,
        })),
      });

      expect(result.items).toHaveLength(200);
      expect(result.items[199].itemNumber).toBe(2000);
      expect(result.totals?.netValue).toBe('60.00');
    });

    it('calculates the largest values exactly', async () => {
      await prisma.material.update({
        where: { materialNumber: 'MAT-001' },
        data: { price: '9999999999.99' },
      });

      const result = await simulate({
        ...muellerOrder,
        items: [
          { materialNumber: 'MAT-001', quantity: 99999 },
          { materialNumber: 'MAT-001', quantity: 99999 },
        ],
      });

      expect(result.items[0].netValue).toBe('999989999999000.01');
      expect(result.totals?.netValue).toBe('1999979999998000.02');
    });
  });

  describe('malformed requests', () => {
    it.each([
      ['no items', { items: [] }],
      [
        '201 items',
        {
          items: Array.from({ length: 201 }, () => ({
            materialNumber: 'MAT-001',
            quantity: 1,
          })),
        },
      ],
      ['quantity 0', { items: [{ materialNumber: 'MAT-001', quantity: 0 }] }],
      ['a missing pricing date', { pricingDate: undefined }],
      ['an unknown shipping method', { requestedShippingMethod: 'DRONE' }],
      [
        'a customer reference of 36 characters',
        { customerReference: 'P'.repeat(36) },
      ],
    ])('answers 400 for %s', async (_case, change) => {
      await http()
        .post('/sales-orders/simulate')
        .send({ ...muellerOrder, ...change })
        .expect(400);
    });

    it('only accepts POST', async () => {
      await http().get('/sales-orders/simulate').expect(404);
      await http().get('/sales-orders').expect(404);
    });
  });

  describe('read-only', () => {
    it('never changes any data, whatever is simulated', async () => {
      const before = await tableFingerprint(prisma);

      for (let i = 0; i < 5; i++) {
        await simulate(muellerOrder);
        await simulate({
          ...muellerOrder,
          customerNote: 'Bitte anrufen',
          requestedShippingMethod: 'EXPRESS',
        });
        await simulate({ ...muellerOrder, unitId: 'NOPE' });
        await simulate({
          ...muellerOrder,
          items: [{ materialNumber: 'MAT-999', quantity: 1 }],
        });
      }

      expect(await tableFingerprint(prisma)).toEqual(before);
    });
  });
});
