import { PartnerSummary } from '../common/partner-summary';
import { PricingSource } from '../pricing/price-determination';
import { PriceResultStep } from '../pricing/price-result.interface';
import { RequestedShippingMethod } from './dto/simulate-sales-order.dto';

export type SimulationStatus = 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID';

export type MessageSeverity = 'ERROR' | 'WARNING' | 'INFO';

/**
 * A business message. ERROR makes the simulation INVALID, WARNING makes it
 * VALID_WITH_WARNINGS, INFO does not change the status.
 */
export interface SimulationMessage {
  severity: MessageSeverity;
  code: string;
  text: string;
  /** The request field or partner role the message is about, if any */
  field?: string;
}

export type CheckResult =
  | 'PASSED'
  | 'FAILED'
  /** The check was not carried out, so its result is unknown; `text` says why */
  | 'NOT_PERFORMED';

export interface SimulationCheck {
  check: string;
  result: CheckResult;
  text?: string;
}

export interface SimulationPartners {
  unit: { unitId: string; name: string; isActive: boolean };
  account: PartnerSummary;
  soldTo: PartnerSummary;
  billTo: PartnerSummary;
  payer: PartnerSummary;
  /** null if the requested Ship-to is not allowed for the unit */
  shipTo: (PartnerSummary & { isDefault: boolean }) | null;
}

export interface SimulatedItem {
  /** 10, 20, 30, ... in request order */
  itemNumber: number;
  materialNumber: string;
  /** null if the material does not exist */
  materialDescription: string | null;
  quantity: number;
  /** Decimal strings; null if the position cannot be priced */
  unitPrice: string | null;
  netValue: string | null;
  currency: string | null;
  pricing: {
    source: PricingSource;
    conditionId: number | null;
    validFrom: string | null;
    validTo: string | null;
    steps: PriceResultStep[];
  } | null;
  /** Messages about this position */
  messages: SimulationMessage[];
}

/**
 * The delivery block a real order WOULD receive. During a simulation
 * nothing is stored and no block exists.
 */
export interface ProposedOrderBlock {
  type: 'DELIVERY_BLOCK';
  code: 'SALES_REVIEW';
  reason: 'CUSTOMER_NOTE';
  description: string;
}

/**
 * Result of POST /sales-orders/simulate. Nothing is stored: there is no
 * sales order, no delivery block and no stock reservation. A VALID result
 * does not guarantee that an order can be delivered, see `checks`.
 */
export interface SalesOrderSimulation {
  simulated: true;
  status: SimulationStatus;
  /** The order date; prices valid on this date are used */
  pricingDate: string;
  /** As requested by the customer; never a confirmed delivery date */
  requestedDeliveryDate: string | null;
  requestedShippingMethod: RequestedShippingMethod;
  customerReference: string | null;
  customerNote: string | null;
  /** null if the unit does not exist */
  partners: SimulationPartners | null;
  items: SimulatedItem[];
  /** Only for simulations without errors; never a partial total */
  totals: {
    netValue: string;
    currency: string;
    includes: 'NET_EXCL_TAX_AND_FREIGHT';
  } | null;
  requiresSalesReview: boolean;
  proposedOrderBlock: ProposedOrderBlock | null;
  checks: SimulationCheck[];
  /** Messages about the order header; item messages are in the items */
  messages: SimulationMessage[];
}
