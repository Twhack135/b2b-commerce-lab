import { PricingSource } from '../pricing/price-determination';
import { SalesAreaKey } from '../sales-areas/sales-area-key';
import { RequestedShippingMethod } from './dto/simulate-sales-order.dto';

export type SalesOrderStatus = 'OPEN';

/** Header delivery block (like SAP LIFSK) */
export type SalesOrderDeliveryBlock = 'SALES_REVIEW';

/** A partner of the order as it was when the order was created */
export interface SalesOrderPartner {
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
}

/** The price condition an item used, as it was when the order was created */
export interface SalesOrderItemCondition {
  /** 10 = price; later steps (discounts, freight, tax) follow */
  stepNumber: number;
  conditionType: { code: string; name: string };
  source: PricingSource;
  conditionId: number;
  /** Amount per piece, in the document currency */
  amount: string;
  validFrom: string;
  validTo: string | null;
  /** Value of the condition for the item quantity */
  value: string;
}

export interface SalesOrderItem {
  /** 10, 20, 30, ... */
  itemNumber: number;
  materialNumber: string;
  materialDescription: string;
  quantity: number;
  unitPrice: string;
  netValue: string;
  conditions: SalesOrderItemCondition[];
}

/**
 * A stored sales order. Everything shown here comes from the order itself
 * (snapshots), never from current master data or price conditions, so the
 * document stays the same when those change later.
 */
export interface SalesOrder {
  salesOrderNumber: string;
  /** The creation attempt of the client that created this order */
  requestId: string;
  status: SalesOrderStatus;
  deliveryBlock: SalesOrderDeliveryBlock | null;
  salesArea: SalesAreaKey;
  /** Document currency and its decimal places */
  currency: string;
  currencyDecimals: number;
  /** Order date = pricing date, in the time zone of the sales organization */
  orderDate: string;
  timeZone: string;
  /** As requested by the customer; never a confirmed delivery date */
  requestedDeliveryDate: string | null;
  requestedShippingMethod: RequestedShippingMethod;
  customerReference: string | null;
  customerNote: string | null;
  unit: { unitId: string; name: string };
  partners: {
    soldTo: SalesOrderPartner;
    shipTo: SalesOrderPartner;
    billTo: SalesOrderPartner;
    payer: SalesOrderPartner;
  };
  items: SalesOrderItem[];
  totals: {
    netValue: string;
    currency: string;
    includes: 'NET_EXCL_TAX_AND_FREIGHT';
  };
  /** ISO 8601 timestamps */
  createdAt: string;
  updatedAt: string;
}

/**
 * A stored sales order in the order list (GET /sales-orders): header data
 * and the Sold-to only, all from the order's own snapshots
 */
export interface SalesOrderSummary {
  salesOrderNumber: string;
  orderDate: string;
  /** ISO 8601 timestamp */
  createdAt: string;
  status: SalesOrderStatus;
  deliveryBlock: SalesOrderDeliveryBlock | null;
  salesArea: SalesAreaKey;
  soldTo: { customerNumber: string; name: string };
  unit: { unitId: string; name: string };
  customerReference: string | null;
  itemCount: number;
  /** Net value excluding tax and freight, in the document currency */
  netValue: string;
  currency: string;
  currencyDecimals: number;
}

/**
 * One page of the order list, newest sales order number first. `total`
 * counts all orders matching the search and filters (not only this page);
 * `nextCursor` is the `after` value of the next page, null on the last page.
 */
export interface SalesOrderList {
  items: SalesOrderSummary[];
  total: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}
