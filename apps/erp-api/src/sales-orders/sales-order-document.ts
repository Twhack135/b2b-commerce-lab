import { fromDbDate, toDbDate } from '../common/dates';
import { formatInCurrency } from '../common/money';
import { Prisma } from '../generated/prisma/client';
import { RequestedShippingMethod } from './dto/simulate-sales-order.dto';
import { OrderEvaluation } from './order-evaluation';
import {
  SalesOrder,
  SalesOrderPartner as SalesOrderPartnerView,
} from './sales-order.interface';

/** Step of the price in the applied conditions of an item */
export const PRICE_STEP = 10;

/** What a stored sales order is read with */
export const ORDER_INCLUDE = {
  partners: true,
  items: {
    orderBy: { itemNumber: 'asc' },
    include: { conditions: { orderBy: { stepNumber: 'asc' } } },
  },
} satisfies Prisma.SalesOrderInclude;

export type SalesOrderRecord = Prisma.SalesOrderGetPayload<{
  include: typeof ORDER_INCLUDE;
}>;

/** The rows that store one sales order */
export interface SalesOrderRows {
  header: Prisma.SalesOrderUncheckedCreateInput;
  partners: Prisma.SalesOrderPartnerCreateManyInput[];
  items: Prisma.SalesOrderItemCreateManyInput[];
  conditions: Prisma.SalesOrderItemConditionCreateManyInput[];
}

/**
 * The rows of a new sales order from an evaluation without errors: snapshots
 * of the unit, the partners with their addresses, the materials and the
 * applied price conditions. Amounts are taken from the price determination,
 * exactly as the evaluation calculated them.
 */
export function salesOrderRows(
  evaluation: OrderEvaluation,
  document: {
    salesOrderNumber: string;
    requestId: string;
    requestHash: string;
    orderDate: string;
    timeZone: string;
  },
): SalesOrderRows {
  const { simulation, unit, salesArea, pricings } = evaluation;
  const shipTo = simulation.partners?.shipTo;
  const shipToAssignment = unit?.shipTos.find(
    (s) => s.customerNumber === shipTo?.customerNumber,
  );
  if (
    simulation.status === 'INVALID' ||
    !simulation.totals ||
    !unit ||
    !salesArea ||
    !shipToAssignment
  ) {
    // The caller only stores orders without errors
    throw new Error('Only a complete order without errors can be stored');
  }
  const { salesOrderNumber } = document;
  const key = simulation.salesArea;

  const partner = (
    role: 'SOLD_TO' | 'SHIP_TO' | 'BILL_TO' | 'PAYER',
    customer: {
      customerNumber: string;
      name: string;
      street: string;
      postalCode: string;
      city: string;
      country: string;
    },
  ): Prisma.SalesOrderPartnerCreateManyInput => ({
    salesOrderNumber,
    role,
    customerNumber: customer.customerNumber,
    name: customer.name,
    street: customer.street,
    postalCode: customer.postalCode,
    city: customer.city,
    country: customer.country,
  });

  const items: Prisma.SalesOrderItemCreateManyInput[] = [];
  const conditions: Prisma.SalesOrderItemConditionCreateManyInput[] = [];
  simulation.items.forEach((item, index) => {
    const { material, determination } = pricings[index];
    if (
      !material ||
      determination?.status !== 'PRICED' ||
      !determination.conditionType
    ) {
      throw new Error(`Item ${item.itemNumber} has no price`);
    }
    items.push({
      salesOrderNumber,
      itemNumber: item.itemNumber,
      materialNumber: material.materialNumber,
      materialDescription: material.description,
      quantity: item.quantity,
      unitPrice: determination.unitPrice,
      netValue: determination.netValue,
    });
    const condition = determination.condition;
    conditions.push({
      salesOrderNumber,
      itemNumber: item.itemNumber,
      stepNumber: PRICE_STEP,
      ...key,
      materialNumber: material.materialNumber,
      conditionId: condition.conditionId,
      conditionTypeCode: determination.conditionType.code,
      conditionTypeName: determination.conditionType.name,
      scope: determination.source,
      amount: condition.amount,
      validFrom: toDbDate(condition.validFrom),
      validTo: condition.validTo === null ? null : toDbDate(condition.validTo),
      conditionValue: determination.netValue,
    });
  });

  return {
    header: {
      salesOrderNumber,
      requestId: document.requestId,
      requestHash: document.requestHash,
      status: 'OPEN',
      // A customer note always needs a Sales review before delivery
      deliveryBlock: simulation.proposedOrderBlock ? 'SALES_REVIEW' : null,
      ...key,
      currency: salesArea.currency.code,
      currencyDecimals: salesArea.currency.decimals,
      orderDate: toDbDate(document.orderDate),
      timeZone: document.timeZone,
      requestedDeliveryDate:
        simulation.requestedDeliveryDate === null
          ? null
          : toDbDate(simulation.requestedDeliveryDate),
      requestedShippingMethod: simulation.requestedShippingMethod,
      customerReference: simulation.customerReference,
      customerNote: simulation.customerNote,
      unitId: unit.unitId,
      unitName: unit.name,
      netValue: simulation.totals.netValue,
    },
    partners: [
      partner('SOLD_TO', unit.soldTo.customer),
      partner('SHIP_TO', shipToAssignment.member.customer),
      partner('BILL_TO', unit.billTo.customer),
      partner('PAYER', unit.payer.customer),
    ],
    items,
    conditions,
  };
}

/**
 * The API view of a stored order. It only uses the stored rows (snapshots),
 * never current master data, so it always shows the order as created.
 */
export function toSalesOrder(record: SalesOrderRecord): SalesOrder {
  const currency = { decimals: record.currencyDecimals };
  const money = (value: Prisma.Decimal) => formatInCurrency(value, currency);
  const partner = (role: string): SalesOrderPartnerView => {
    const row = record.partners.find((p) => p.role === role);
    if (!row) {
      throw new Error(
        `Sales order ${record.salesOrderNumber} has no partner ${role}`,
      );
    }
    return {
      customerNumber: row.customerNumber,
      name: row.name,
      street: row.street,
      postalCode: row.postalCode,
      city: row.city,
      country: row.country,
    };
  };

  return {
    salesOrderNumber: record.salesOrderNumber,
    requestId: record.requestId,
    status: record.status,
    deliveryBlock: record.deliveryBlock,
    salesArea: {
      salesOrganization: record.salesOrganization,
      distributionChannel: record.distributionChannel,
      division: record.division,
    },
    currency: record.currency,
    currencyDecimals: record.currencyDecimals,
    orderDate: fromDbDate(record.orderDate),
    timeZone: record.timeZone,
    requestedDeliveryDate: record.requestedDeliveryDate
      ? fromDbDate(record.requestedDeliveryDate)
      : null,
    requestedShippingMethod:
      RequestedShippingMethod[record.requestedShippingMethod],
    customerReference: record.customerReference,
    customerNote: record.customerNote,
    unit: { unitId: record.unitId, name: record.unitName },
    partners: {
      soldTo: partner('SOLD_TO'),
      shipTo: partner('SHIP_TO'),
      billTo: partner('BILL_TO'),
      payer: partner('PAYER'),
    },
    items: record.items.map((item) => ({
      itemNumber: item.itemNumber,
      materialNumber: item.materialNumber,
      materialDescription: item.materialDescription,
      quantity: item.quantity,
      unitPrice: money(item.unitPrice),
      netValue: money(item.netValue),
      conditions: item.conditions.map((condition) => ({
        stepNumber: condition.stepNumber,
        conditionType: {
          code: condition.conditionTypeCode,
          name: condition.conditionTypeName,
        },
        source: condition.scope,
        conditionId: condition.conditionId,
        amount: money(condition.amount),
        validFrom: fromDbDate(condition.validFrom),
        validTo: condition.validTo ? fromDbDate(condition.validTo) : null,
        value: money(condition.conditionValue),
      })),
    })),
    totals: {
      netValue: money(record.netValue),
      currency: record.currency,
      includes: 'NET_EXCL_TAX_AND_FREIGHT',
    },
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
