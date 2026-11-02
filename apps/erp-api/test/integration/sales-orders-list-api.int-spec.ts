import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
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
  TestClock,
} from './helpers';

// The order list GET /sales-orders (Sprint 10D-A): read-only, searched and
// filtered on the server, newest sales order number first, keyset pagination.
// Orders are created through POST /sales-orders, like real orders.

type Summary = {
  salesOrderNumber: string;
  orderDate: string;
  createdAt: string;
  status: string;
  deliveryBlock: string | null;
  salesArea: typeof GERMANY;
  soldTo: { customerNumber: string; name: string };
  unit: { unitId: string; name: string };
  customerReference: string | null;
  itemCount: number;
  netValue: string;
  currency: string;
  currencyDecimals: number;
};

type List = {
  items: Summary[];
  total: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
};

const SUMMARY_FIELDS = [
  'salesOrderNumber',
  'orderDate',
  'createdAt',
  'status',
  'deliveryBlock',
  'salesArea',
  'soldTo',
  'unit',
  'customerReference',
  'itemCount',
  'netValue',
  'currency',
  'currencyDecimals',
];

/** 10:00 UTC on the day: the same calendar day in Berlin, Warsaw and Tokyo */
const day = (date: string) => `${date}T10:00:00.000Z`;

const item = (
  materialNumber: string,
  quantity: number,
  expectedUnitPrice: string,
) => ({ materialNumber, quantity, expectedUnitPrice });

/** One heat pump for the Stuttgart unit: 4400.00 EUR (ZP03 Sold-to price) */
const stuttgartOrder = (change: object = {}) => ({
  requestId: randomUUID(),
  ...GERMANY,
  unitId: 'UNIT-STUTTGART',
  items: [item('MAT-001', 1, '4400.00')],
  expectedTotal: { netValue: '4400.00', currency: 'EUR' },
  ...change,
});

describe('Sales order list API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];
  const clock = new TestClock(new Date(day('2026-11-15')));

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp({ clock }));
  });

  afterAll(async () => {
    await app.close();
  });

  /** Test data of the Müller account, Poland and Japan without orders */
  async function createMasterData() {
    clock.set(day('2026-11-15'));
    await resetDatabase(prisma);
    await createMuellerData(prisma);
    await createPolandData(prisma);
    await createJapanData(prisma);
    await prisma.customer.update({
      where: { customerNumber: 'CUST-1000' },
      data: { name: 'Müller Heiztechnik GmbH' },
    });
    // Like condition #4 of the development data
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
  }

  async function place(body: object, date = '2026-11-15'): Promise<string> {
    clock.set(day(date));
    const response = await http().post('/sales-orders').send(body).expect(201);
    return (response.body as { salesOrderNumber: string }).salesOrderNumber;
  }

  async function list(query: Record<string, string> = {}): Promise<List> {
    const response = await http().get('/sales-orders').query(query).expect(200);
    return response.body as List;
  }

  const numbers = async (query: Record<string, string> = {}) =>
    (await list(query)).items.map((o) => o.salesOrderNumber);

  async function badRequest(query: Record<string, string>) {
    const response = await http().get('/sales-orders').query(query).expect(400);
    return (response.body as { message: string[] }).message;
  }

  describe('without orders', () => {
    beforeAll(createMasterData);

    it('returns an empty list', async () => {
      expect(await list()).toEqual({
        items: [],
        total: 0,
        limit: 25,
        hasMore: false,
        nextCursor: null,
      });
    });
  });

  describe('search and filters', () => {
    // 1 Stuttgart, 2026-11-01, 2 items, 10695.00 EUR
    // 2 München, 2026-11-15, customer note -> SALES_REVIEW, 4400.00 EUR
    // 3 Stuttgart, 2026-11-30, no reference, 13200.00 EUR
    // 4 Warszawa, 2026-11-15, 198.00 PLN, reference with % and _
    // 5 Osaka, 2026-11-15, 1400000 JPY, lower-case reference
    beforeAll(async () => {
      await createMasterData();
      await place(
        stuttgartOrder({
          customerReference: 'PO-STR-2026-118',
          items: [item('MAT-001', 2, '4400.00'), item('MAT-002', 10, '189.50')],
          expectedTotal: { netValue: '10695.00', currency: 'EUR' },
        }),
        '2026-11-01',
      );
      await place(
        stuttgartOrder({
          unitId: 'UNIT-MUENCHEN',
          customerReference: 'PO-MUC-7',
          customerNote: 'Please call before delivery',
        }),
      );
      await place(
        stuttgartOrder({
          items: [item('MAT-001', 3, '4400.00')],
          expectedTotal: { netValue: '13200.00', currency: 'EUR' },
        }),
        '2026-11-30',
      );
      await place({
        requestId: randomUUID(),
        ...POLAND,
        unitId: 'UNIT-WARSZAWA',
        customerReference: 'PL-50%_OFF',
        items: [item('MAT-PL', 2, '99.00')],
        expectedTotal: { netValue: '198.00', currency: 'PLN' },
      });
      await place({
        requestId: randomUUID(),
        ...JAPAN,
        unitId: 'UNIT-OSAKA',
        customerReference: 'po-str-jp',
        items: [item('MAT-001', 2, '700000')],
        expectedTotal: { netValue: '1400000', currency: 'JPY' },
      });
      // Master data changed after the orders: the list shows the snapshots
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { name: 'Renamed AG' },
      });
      await prisma.b2bUnit.update({
        where: { unitId: 'UNIT-STUTTGART' },
        data: { name: 'Renamed unit' },
      });
    });

    it('lists all orders, newest number first', async () => {
      const result = await list();
      expect(result).toMatchObject({
        total: 5,
        limit: 25,
        hasMore: false,
        nextCursor: null,
      });
      expect(result.items.map((o) => o.salesOrderNumber)).toEqual([
        '1000000005',
        '1000000004',
        '1000000003',
        '1000000002',
        '1000000001',
      ]);
    });

    it('returns the summary fields only, from the snapshots of the order', async () => {
      const { items } = await list();
      for (const order of items) {
        expect(Object.keys(order)).toEqual(SUMMARY_FIELDS);
      }
      const first = items.find((o) => o.salesOrderNumber === '1000000001');
      expect(first).toEqual({
        salesOrderNumber: '1000000001',
        orderDate: '2026-11-01',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
        status: 'OPEN',
        deliveryBlock: null,
        salesArea: GERMANY,
        // Snapshots: the customer and the unit were renamed afterwards
        soldTo: {
          customerNumber: 'CUST-1000',
          name: 'Müller Heiztechnik GmbH',
        },
        unit: { unitId: 'UNIT-STUTTGART', name: 'Müller UNIT-STUTTGART' },
        customerReference: 'PO-STR-2026-118',
        itemCount: 2,
        netValue: '10695.00',
        currency: 'EUR',
        currencyDecimals: 2,
      });
    });

    it('exposes no internal or detail data', async () => {
      const body = JSON.stringify(await list());
      for (const hidden of [
        'requestId',
        'requestHash',
        'customerNote',
        'Please call before delivery',
        'partners',
        'shipTo',
        'billTo',
        'payer',
        'street',
        'Teststraße',
        'items":[{"itemNumber',
        'timeZone',
        'updatedAt',
      ]) {
        expect(body).not.toContain(hidden);
      }
    });

    it('lists EUR, PLN and JPY values in the decimals of their currency', async () => {
      const byNumber = Object.fromEntries(
        (await list()).items.map((o) => [o.salesOrderNumber, o]),
      );
      expect(byNumber['1000000002']).toMatchObject({
        netValue: '4400.00',
        currency: 'EUR',
        currencyDecimals: 2,
        deliveryBlock: 'SALES_REVIEW',
        itemCount: 1,
      });
      expect(byNumber['1000000004']).toMatchObject({
        netValue: '198.00',
        currency: 'PLN',
        currencyDecimals: 2,
        salesArea: POLAND,
        soldTo: {
          customerNumber: 'PL-1000',
          name: 'Warszawa Ogrzewanie Sp. z o.o.',
        },
      });
      expect(byNumber['1000000005']).toMatchObject({
        netValue: '1400000',
        currency: 'JPY',
        currencyDecimals: 0,
        salesArea: JAPAN,
        unit: { unitId: 'UNIT-OSAKA', name: 'Osaka' },
      });
    });

    describe('search (q)', () => {
      it('finds a 10-digit sales order number exactly', async () => {
        expect(await numbers({ q: '1000000003' })).toEqual(['1000000003']);
        expect(await numbers({ q: ' 1000000003 ' })).toEqual(['1000000003']);
        expect(await numbers({ q: '1000000009' })).toEqual([]);
      });

      it('searches shorter numbers as text, not as part of order numbers', async () => {
        // "100000000" is part of every order number, but no reference or customer
        expect(await numbers({ q: '100000000' })).toEqual([]);
        expect(await numbers({ q: '2026' })).toEqual(['1000000001']);
      });

      it('finds the customer reference, case-insensitive', async () => {
        expect(await numbers({ q: 'po-str' })).toEqual([
          '1000000005',
          '1000000001',
        ]);
        expect(await numbers({ q: 'MUC' })).toEqual(['1000000002']);
      });

      it('finds the Sold-to number and name (snapshot), case-insensitive', async () => {
        expect(await numbers({ q: 'cust-1000' })).toEqual([
          '1000000003',
          '1000000002',
          '1000000001',
        ]);
        expect(await numbers({ q: 'MÜLLER heiz' })).toEqual([
          '1000000003',
          '1000000002',
          '1000000001',
        ]);
        expect(await numbers({ q: 'osaka' })).toEqual(['1000000005']);
        // The current name is not searched, the snapshot is
        expect(await numbers({ q: 'Renamed' })).toEqual([]);
      });

      it('searches % and _ literally', async () => {
        expect(await numbers({ q: '%' })).toEqual(['1000000004']);
        expect(await numbers({ q: '_' })).toEqual(['1000000004']);
        expect(await numbers({ q: '50%_off' })).toEqual(['1000000004']);
        expect(await numbers({ q: '5_%' })).toEqual([]);
      });

      it('combines the search with filters (AND)', async () => {
        expect(
          await numbers({ q: 'po-str', salesOrganization: '1000' }),
        ).toEqual(['1000000001']);
        expect(
          await numbers({ q: 'po-str', deliveryBlock: 'SALES_REVIEW' }),
        ).toEqual([]);
      });

      it('does not search other fields, e.g. the customer note or unit', async () => {
        expect(await numbers({ q: 'Please call' })).toEqual([]);
        expect(await numbers({ q: 'UNIT-MUENCHEN' })).toEqual([]);
      });
    });

    describe('filters', () => {
      it('filters by sales organization, channel and division', async () => {
        expect(await numbers({ salesOrganization: '2000' })).toEqual([
          '1000000004',
        ]);
        expect(
          await numbers({
            salesOrganization: '1000',
            distributionChannel: '10',
          }),
        ).toEqual(['1000000003', '1000000002', '1000000001']);
        expect(await numbers({ ...GERMANY })).toEqual([
          '1000000003',
          '1000000002',
          '1000000001',
        ]);
        // Well-formed but without orders (or not configured): empty, not 400
        expect(
          await numbers({
            salesOrganization: '1000',
            distributionChannel: '20',
          }),
        ).toEqual([]);
        expect(await numbers({ salesOrganization: '9999' })).toEqual([]);
      });

      it('filters by the exact Sold-to customer number', async () => {
        expect(await numbers({ soldTo: 'CUST-1000' })).toEqual([
          '1000000003',
          '1000000002',
          '1000000001',
        ]);
        expect(await numbers({ soldTo: 'JP-1000' })).toEqual(['1000000005']);
        expect(await numbers({ soldTo: 'CUST-10' })).toEqual([]);
        // The Ship-to of the Stuttgart orders is no Sold-to
        expect(await numbers({ soldTo: 'CUST-1100' })).toEqual([]);
      });

      it('filters by B2B unit', async () => {
        expect(await numbers({ unitId: 'UNIT-MUENCHEN' })).toEqual([
          '1000000002',
        ]);
        expect(await numbers({ unitId: 'UNIT-STUTTGART' })).toEqual([
          '1000000003',
          '1000000001',
        ]);
      });

      it('filters by delivery block', async () => {
        expect(await numbers({ deliveryBlock: 'SALES_REVIEW' })).toEqual([
          '1000000002',
        ]);
        expect(await numbers({ deliveryBlock: 'NONE' })).toEqual([
          '1000000005',
          '1000000004',
          '1000000003',
          '1000000001',
        ]);
      });

      it('filters by order date, both ends included', async () => {
        expect(await numbers({ orderDateFrom: '2026-11-15' })).toEqual([
          '1000000005',
          '1000000004',
          '1000000003',
          '1000000002',
        ]);
        expect(await numbers({ orderDateTo: '2026-11-15' })).toEqual([
          '1000000005',
          '1000000004',
          '1000000002',
          '1000000001',
        ]);
        expect(
          await numbers({
            orderDateFrom: '2026-11-15',
            orderDateTo: '2026-11-15',
          }),
        ).toEqual(['1000000005', '1000000004', '1000000002']);
        expect(
          await numbers({
            orderDateFrom: '2026-11-16',
            orderDateTo: '2026-12-31',
          }),
        ).toEqual(['1000000003']);
      });

      it('counts total over all filters', async () => {
        const result = await list({ ...GERMANY, limit: '1' });
        expect(result).toMatchObject({
          total: 3,
          hasMore: true,
          nextCursor: '1000000003',
        });
      });
    });

    describe('invalid parameters (400)', () => {
      it.each([
        [
          'an unknown parameter',
          { page: '2' },
          'property page should not exist',
        ],
        [
          'an internal field',
          { requestId: 'x' },
          'property requestId should not exist',
        ],
        [
          'a before cursor',
          { before: '1000000003' },
          'property before should not exist',
        ],
        [
          'an invalid date',
          { orderDateFrom: '2026-02-30' },
          'orderDateFrom must be a valid date in the form YYYY-MM-DD (years 1900 to 9999)',
        ],
        [
          'an end before the start',
          { orderDateFrom: '2026-11-30', orderDateTo: '2026-11-01' },
          'orderDateTo must not be before orderDateFrom',
        ],
        [
          'limit 0',
          { limit: '0' },
          'limit must be a whole number from 1 to 100',
        ],
        [
          'limit 101',
          { limit: '101' },
          'limit must be a whole number from 1 to 100',
        ],
        [
          'a malformed cursor',
          { after: 'abc' },
          'after must be the nextCursor of a previous page',
        ],
        [
          'a channel without sales organization',
          { distributionChannel: '10' },
          'distributionChannel can only be used together with salesOrganization',
        ],
        [
          'an unknown delivery block',
          { deliveryBlock: 'CREDIT' },
          'deliveryBlock must be one of: SALES_REVIEW, NONE',
        ],
        [
          'a search text of 101 characters',
          { q: 'x'.repeat(101) },
          'q must be shorter than or equal to 100 characters',
        ],
        ['an empty search text', { q: '' }, 'q must not be blank'],
      ])('rejects %s', async (_case, query, message) => {
        expect(await badRequest(query)).toContain(message);
      });

      it('rejects a repeated parameter', async () => {
        const response = await http()
          .get('/sales-orders?limit=10&limit=20')
          .expect(400);
        expect((response.body as { message: string[] }).message).toContain(
          'limit must be a string',
        );
      });
    });

    it('never changes data', async () => {
      const before = await tableFingerprint(prisma);
      const sequence = () =>
        prisma.$queryRaw<{ last_value: bigint; is_called: boolean }[]>`
          SELECT last_value, is_called FROM sales_order_number_seq`;
      const sequenceBefore = await sequence();
      await list();
      await list({
        q: 'müller',
        ...GERMANY,
        deliveryBlock: 'NONE',
        limit: '1',
      });
      await badRequest({ limit: '0' });
      expect(await tableFingerprint(prisma)).toEqual(before);
      expect(await sequence()).toEqual(sequenceBefore);
    });

    it('keeps the detail endpoint unchanged', async () => {
      const response = await http().get('/sales-orders/1000000002').expect(200);
      expect(response.body).toMatchObject({
        salesOrderNumber: '1000000002',
        requestId: expect.any(String),
        customerNote: 'Please call before delivery',
        deliveryBlock: 'SALES_REVIEW',
        partners: { soldTo: { customerNumber: 'CUST-1000' } },
        totals: { netValue: '4400.00', currency: 'EUR' },
      });
      await http().get('/sales-orders/1000009999').expect(404);
      await http().get('/sales-orders/12345').expect(404);
      await http().get('/sales-orders/simulate').expect(404);
      // The list parameters and their validation apply to the list only
      const withQuery = await http()
        .get('/sales-orders/1000000002?limit=0&unknown=1')
        .expect(200);
      expect(withQuery.body).toEqual(response.body);
    });

    it('reads a page with a fixed number of queries (no N+1)', async () => {
      // Every statement on a pg connection, e.g. BEGIN, SELECT, COMMIT
      const query = Object.getOwnPropertyDescriptor(Client.prototype, 'query')
        ?.value as (...args: unknown[]) => unknown;
      let statements = 0;
      let queued = 0;
      const spy = jest
        .spyOn(Client.prototype, 'query')
        .mockImplementation(function (this: Client, ...args: unknown[]) {
          statements++;
          const internals = this as unknown as {
            _queryQueue?: unknown[];
            pipeline?: boolean;
          };
          if ((internals._queryQueue?.length ?? 0) > 0 && !internals.pipeline) {
            queued++;
          }
          return query.apply(this, args);
        } as typeof Client.prototype.query);
      try {
        const count = async (limit: string) => {
          statements = 0;
          expect((await list({ limit })).items).toHaveLength(Number(limit));
          return statements;
        };
        const one = await count('1');
        const five = await count('5');
        // BEGIN, SET TRANSACTION READ ONLY, count, page, COMMIT at least
        expect(one).toBeGreaterThanOrEqual(5);
        expect(five).toBe(one);
        // No query waits behind another on the transaction's connection
        expect(queued).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('pagination', () => {
    /** 30 orders; every third one has a customer note (SALES_REVIEW) */
    async function createThirtyOrders() {
      await createMasterData();
      for (let i = 1; i <= 30; i++) {
        await place(
          stuttgartOrder({
            customerReference: `PO-${i}`,
            ...(i % 3 === 0 ? { customerNote: 'Check' } : {}),
          }),
        );
      }
    }

    /** All orders page by page; fails if a page repeats an order */
    async function walk(query: Record<string, string>) {
      const seen: string[] = [];
      const pages: List[] = [];
      let after: string | null = null;
      do {
        const page = await list(after ? { ...query, after } : query);
        pages.push(page);
        seen.push(...page.items.map((o) => o.salesOrderNumber));
        after = page.nextCursor;
      } while (after);
      return { seen, pages };
    }

    const all = Array.from({ length: 30 }, (_, i) => String(1000000030 - i));

    describe('with 30 orders', () => {
      beforeAll(createThirtyOrders);

      it('returns 25 orders on the first page by default', async () => {
        const first = await list();
        expect(first).toMatchObject({
          total: 30,
          limit: 25,
          hasMore: true,
          nextCursor: '1000000006',
        });
        expect(first.items.map((o) => o.salesOrderNumber)).toEqual(
          all.slice(0, 25),
        );
        const second = await list({ after: first.nextCursor! });
        expect(second).toMatchObject({
          total: 30,
          hasMore: false,
          nextCursor: null,
        });
        expect(second.items.map((o) => o.salesOrderNumber)).toEqual(
          all.slice(25),
        );
      });

      it('walks all orders without duplicates or gaps', async () => {
        const { seen, pages } = await walk({ limit: '7' });
        expect(seen).toEqual(all);
        expect(pages.map((p) => p.items.length)).toEqual([7, 7, 7, 7, 2]);
        expect(pages.every((p) => p.total === 30)).toBe(true);
      });

      it('reports more orders only if they exist (limit + 1)', async () => {
        expect(await list({ limit: '30' })).toMatchObject({
          hasMore: false,
          nextCursor: null,
        });
        expect(await list({ limit: '29' })).toMatchObject({
          hasMore: true,
          nextCursor: '1000000002',
        });
        expect((await list({ limit: '100' })).items).toHaveLength(30);
      });

      it('applies the cursor together with all filters', async () => {
        const { seen } = await walk({
          deliveryBlock: 'SALES_REVIEW',
          limit: '4',
        });
        expect(seen).toEqual(all.filter((n) => Number(n.slice(-2)) % 3 === 0));
        const { seen: unblocked } = await walk({
          deliveryBlock: 'NONE',
          q: 'po-',
          limit: '6',
        });
        expect(unblocked).toEqual(
          all.filter((n) => Number(n.slice(-2)) % 3 !== 0),
        );
      });

      it('lists the orders before any cursor number, also an unknown one', async () => {
        expect(await numbers({ after: '1000000099', limit: '3' })).toEqual(
          all.slice(0, 3),
        );
        expect(await list({ after: '1000000001' })).toMatchObject({
          items: [],
          total: 30,
          hasMore: false,
          nextCursor: null,
        });
      });

      it('returns the same page for the same request (stable order)', async () => {
        const query = { limit: '10', after: '1000000020' };
        expect(await list(query)).toEqual(await list(query));
      });
    });

    describe('orders created between page requests', () => {
      beforeEach(createThirtyOrders);

      it('neither repeats nor skips listed orders; new ones are on a new first page', async () => {
        const first = await list({ limit: '10' });
        expect(first.nextCursor).toBe('1000000021');

        await place(stuttgartOrder({ customerReference: 'PO-NEW-1' }));
        await place(stuttgartOrder({ customerReference: 'PO-NEW-2' }));

        const second = await list({ limit: '10', after: first.nextCursor! });
        expect(second.items.map((o) => o.salesOrderNumber)).toEqual(
          all.slice(10, 20),
        );
        // total counts all matching orders at the time of the request
        expect(second.total).toBe(32);

        const fresh = await list({ limit: '10' });
        expect(fresh.items.slice(0, 2).map((o) => o.salesOrderNumber)).toEqual([
          '1000000032',
          '1000000031',
        ]);
      });
    });
  });
});
