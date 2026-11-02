import { fromDbDate, toDbDate } from '../common/dates';
import { formatInCurrency } from '../common/money';
import { Prisma } from '../generated/prisma/client';
import {
  DEFAULT_LIST_LIMIT,
  ListSalesOrdersQueryDto,
  SALES_ORDER_NUMBER_PATTERN,
} from './dto/list-sales-orders.dto';
import { SalesOrderList, SalesOrderSummary } from './sales-order.interface';

// The order list (GET /sales-orders): search, filters and keyset pagination.
// Orders are listed by sales order number, newest number first. Numbers come
// from a sequence, so this is the order in which numbers were drawn, which
// is not necessarily the order in which the transactions committed.

/** What a list row is read with: the header and the Sold-to snapshot */
export const SUMMARY_SELECT = {
  salesOrderNumber: true,
  orderDate: true,
  createdAt: true,
  status: true,
  deliveryBlock: true,
  salesOrganization: true,
  distributionChannel: true,
  division: true,
  unitId: true,
  unitName: true,
  customerReference: true,
  netValue: true,
  currency: true,
  currencyDecimals: true,
  partners: {
    where: { role: 'SOLD_TO' },
    select: { customerNumber: true, name: true },
  },
  _count: { select: { items: true } },
} satisfies Prisma.SalesOrderSelect;

export type SalesOrderSummaryRecord = Prisma.SalesOrderGetPayload<{
  select: typeof SUMMARY_SELECT;
}>;

export const LIST_ORDER_BY = {
  salesOrderNumber: 'desc',
} satisfies Prisma.SalesOrderOrderByWithRelationInput;

/**
 * Text for a LIKE pattern that matches itself only: % and _ (and the escape
 * character \, PostgreSQL's default) lose their special meaning
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Case-insensitive "contains" of literal text */
function containsText(text: string) {
  return { contains: escapeLike(text), mode: 'insensitive' } as const;
}

/**
 * The orders matching the search and filters (without the cursor). Search
 * and filters are combined with AND, the searched fields with OR.
 */
export function listWhere(
  query: ListSalesOrdersQueryDto,
): Prisma.SalesOrderWhereInput {
  const conditions: Prisma.SalesOrderWhereInput[] = [];

  const search = query.q?.trim();
  if (search && SALES_ORDER_NUMBER_PATTERN.test(search)) {
    conditions.push({ salesOrderNumber: search });
  } else if (search) {
    conditions.push({
      OR: [
        { customerReference: containsText(search) },
        {
          partners: {
            some: {
              role: 'SOLD_TO',
              OR: [
                { customerNumber: containsText(search) },
                { name: containsText(search) },
              ],
            },
          },
        },
      ],
    });
  }

  if (query.salesOrganization !== undefined) {
    conditions.push({ salesOrganization: query.salesOrganization });
  }
  if (query.distributionChannel !== undefined) {
    conditions.push({ distributionChannel: query.distributionChannel });
  }
  if (query.division !== undefined) {
    conditions.push({ division: query.division });
  }
  if (query.soldTo !== undefined) {
    conditions.push({
      partners: { some: { role: 'SOLD_TO', customerNumber: query.soldTo } },
    });
  }
  if (query.unitId !== undefined) {
    conditions.push({ unitId: query.unitId });
  }
  if (query.deliveryBlock === 'NONE') {
    conditions.push({ deliveryBlock: null });
  } else if (query.deliveryBlock !== undefined) {
    conditions.push({ deliveryBlock: query.deliveryBlock });
  }
  if (query.orderDateFrom !== undefined) {
    conditions.push({ orderDate: { gte: toDbDate(query.orderDateFrom) } });
  }
  if (query.orderDateTo !== undefined) {
    conditions.push({ orderDate: { lte: toDbDate(query.orderDateTo) } });
  }
  return { AND: conditions };
}

/** The orders of the requested page: those after the cursor */
export function pageWhere(
  query: ListSalesOrdersQueryDto,
): Prisma.SalesOrderWhereInput {
  const where = listWhere(query);
  if (query.after === undefined) return where;
  return { AND: [where, { salesOrderNumber: { lt: query.after } }] };
}

export function listLimit(query: ListSalesOrdersQueryDto): number {
  return query.limit === undefined ? DEFAULT_LIST_LIMIT : Number(query.limit);
}

export function toSalesOrderSummary(
  record: SalesOrderSummaryRecord,
): SalesOrderSummary {
  const [soldTo] = record.partners;
  if (!soldTo) {
    throw new Error(
      `Sales order ${record.salesOrderNumber} has no partner SOLD_TO`,
    );
  }
  return {
    salesOrderNumber: record.salesOrderNumber,
    orderDate: fromDbDate(record.orderDate),
    createdAt: record.createdAt.toISOString(),
    status: record.status,
    deliveryBlock: record.deliveryBlock,
    salesArea: {
      salesOrganization: record.salesOrganization,
      distributionChannel: record.distributionChannel,
      division: record.division,
    },
    soldTo: { customerNumber: soldTo.customerNumber, name: soldTo.name },
    unit: { unitId: record.unitId, name: record.unitName },
    customerReference: record.customerReference,
    itemCount: record._count.items,
    netValue: formatInCurrency(record.netValue, {
      decimals: record.currencyDecimals,
    }),
    currency: record.currency,
    currencyDecimals: record.currencyDecimals,
  };
}

/**
 * The page from up to `limit + 1` rows in list order: the extra row only
 * shows that more orders follow, it is not returned
 */
export function toSalesOrderList(
  rows: SalesOrderSummaryRecord[],
  limit: number,
  total: number,
): SalesOrderList {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(toSalesOrderSummary);
  return {
    items,
    total,
    limit,
    hasMore,
    nextCursor: hasMore ? items[items.length - 1].salesOrderNumber : null,
  };
}
