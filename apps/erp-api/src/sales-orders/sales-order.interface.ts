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
