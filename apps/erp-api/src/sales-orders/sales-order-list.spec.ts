import { Prisma } from '../generated/prisma/client';
import {
  escapeLike,
  listLimit,
  listWhere,
  pageWhere,
  SalesOrderSummaryRecord,
  toSalesOrderList,
  toSalesOrderSummary,
} from './sales-order-list';

const record = (
  salesOrderNumber: string,
  change: Partial<SalesOrderSummaryRecord> = {},
): SalesOrderSummaryRecord => ({
  salesOrderNumber,
  orderDate: new Date('2026-11-15T00:00:00Z'),
  createdAt: new Date('2026-11-15T10:00:00.123Z'),
  status: 'OPEN',
  deliveryBlock: null,
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
  unitId: 'UNIT-STUTTGART',
  unitName: 'Müller – Stuttgart',
  customerReference: 'PO-STR-2026-118',
  netValue: new Prisma.Decimal('10695'),
  currency: 'EUR',
  currencyDecimals: 2,
  partners: [{ customerNumber: 'CUST-1000', name: 'Müller Heiztechnik GmbH' }],
  _count: { items: 2 },
  ...change,
});

describe('order list', () => {
  describe('listWhere', () => {
    it('matches all orders without parameters', () => {
      expect(listWhere({})).toEqual({ AND: [] });
    });

    it('searches a 10-digit number exactly as sales order number', () => {
      expect(listWhere({ q: ' 1000000001 ' })).toEqual({
        AND: [{ salesOrderNumber: '1000000001' }],
      });
    });

    it('searches other text in reference, Sold-to number and name (OR)', () => {
      const contains = { contains: 'müller', mode: 'insensitive' };
      expect(listWhere({ q: '  müller ' })).toEqual({
        AND: [
          {
            OR: [
              { customerReference: contains },
              {
                partners: {
                  some: {
                    role: 'SOLD_TO',
                    OR: [{ customerNumber: contains }, { name: contains }],
                  },
                },
              },
            ],
          },
        ],
      });
    });

    it('searches numbers of other lengths as text', () => {
      expect(JSON.stringify(listWhere({ q: '100000000' }))).toContain(
        '"customerReference":{"contains":"100000000"',
      );
    });

    it('searches % and _ literally', () => {
      expect(JSON.stringify(listWhere({ q: '50%_off\\' }))).toContain(
        '"contains":"50\\\\%\\\\_off\\\\\\\\"',
      );
    });

    it('combines search and every filter with AND', () => {
      expect(
        listWhere({
          q: 'PO',
          salesOrganization: '1000',
          distributionChannel: '10',
          division: '00',
          soldTo: 'CUST-1000',
          unitId: 'UNIT-STUTTGART',
          deliveryBlock: 'SALES_REVIEW',
          orderDateFrom: '2026-11-01',
          orderDateTo: '2026-11-30',
        }).AND,
      ).toEqual([
        expect.objectContaining({ OR: expect.any(Array) }),
        { salesOrganization: '1000' },
        { distributionChannel: '10' },
        { division: '00' },
        {
          partners: { some: { role: 'SOLD_TO', customerNumber: 'CUST-1000' } },
        },
        { unitId: 'UNIT-STUTTGART' },
        { deliveryBlock: 'SALES_REVIEW' },
        { orderDate: { gte: new Date('2026-11-01T00:00:00Z') } },
        { orderDate: { lte: new Date('2026-11-30T00:00:00Z') } },
      ]);
    });

    it('filters orders without delivery block with NONE', () => {
      expect(listWhere({ deliveryBlock: 'NONE' })).toEqual({
        AND: [{ deliveryBlock: null }],
      });
    });
  });

  describe('pageWhere', () => {
    it('is the list condition on the first page', () => {
      expect(pageWhere({ unitId: 'U1' })).toEqual(listWhere({ unitId: 'U1' }));
    });

    it('adds the cursor to all filters', () => {
      expect(pageWhere({ unitId: 'U1', after: '1000000026' })).toEqual({
        AND: [
          { AND: [{ unitId: 'U1' }] },
          { salesOrderNumber: { lt: '1000000026' } },
        ],
      });
    });
  });

  it('uses 25 orders per page unless a limit is given', () => {
    expect(listLimit({})).toBe(25);
    expect(listLimit({ limit: '100' })).toBe(100);
  });

  it('escapeLike escapes the LIKE special characters only', () => {
    expect(escapeLike('a%b_c\\d.e*')).toBe('a\\%b\\_c\\\\d.e*');
  });

  describe('toSalesOrderSummary', () => {
    it('lists header data and the Sold-to snapshot', () => {
      expect(toSalesOrderSummary(record('1000000001'))).toEqual({
        salesOrderNumber: '1000000001',
        orderDate: '2026-11-15',
        createdAt: '2026-11-15T10:00:00.123Z',
        status: 'OPEN',
        deliveryBlock: null,
        salesArea: {
          salesOrganization: '1000',
          distributionChannel: '10',
          division: '00',
        },
        soldTo: {
          customerNumber: 'CUST-1000',
          name: 'Müller Heiztechnik GmbH',
        },
        unit: { unitId: 'UNIT-STUTTGART', name: 'Müller – Stuttgart' },
        customerReference: 'PO-STR-2026-118',
        itemCount: 2,
        netValue: '10695.00',
        currency: 'EUR',
        currencyDecimals: 2,
      });
    });

    it('formats the net value in the decimals of the currency', () => {
      expect(
        toSalesOrderSummary(
          record('1000000001', {
            netValue: new Prisma.Decimal('1400000.00'),
            currency: 'JPY',
            currencyDecimals: 0,
          }),
        ).netValue,
      ).toBe('1400000');
    });

    it('fails for an order without Sold-to (never stored)', () => {
      expect(() =>
        toSalesOrderSummary(record('1000000001', { partners: [] })),
      ).toThrow('Sales order 1000000001 has no partner SOLD_TO');
    });
  });

  describe('toSalesOrderList', () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, i) => record(String(1000000030 - i)));

    it('returns the last page without cursor', () => {
      const list = toSalesOrderList(rows(3), 25, 3);
      expect(list).toMatchObject({
        total: 3,
        limit: 25,
        hasMore: false,
        nextCursor: null,
      });
      expect(list.items).toHaveLength(3);
    });

    it('uses the extra row only to report that more orders follow', () => {
      const list = toSalesOrderList(rows(3), 2, 40);
      expect(list.items.map((o) => o.salesOrderNumber)).toEqual([
        '1000000030',
        '1000000029',
      ]);
      expect(list).toMatchObject({
        total: 40,
        hasMore: true,
        nextCursor: '1000000029',
      });
    });

    it('returns an empty page', () => {
      expect(toSalesOrderList([], 25, 0)).toEqual({
        items: [],
        total: 0,
        limit: 25,
        hasMore: false,
        nextCursor: null,
      });
    });
  });
});
