import type { PartnerSummary } from "./b2b-units";
import type { ConditionTypeSummary } from "./condition-types";
import { erpFetch } from "./erp-api";
import type { PricingSource, PricingStep } from "./pricing";
import type { SalesAreaKey } from "./sales-areas";

// Types of POST /sales-orders/simulate (see apps/erp-api sales-orders).
// Amounts are decimal strings; nothing is ever stored by a simulation.

export type RequestedShippingMethod = "STANDARD" | "EXPRESS";

export type SimulationRequest = SalesAreaKey & {
  unitId: string;
  shipToCustomerNumber: string;
  /** The order date; business rule: pricing date = order date */
  pricingDate: string;
  /** Optional wish of the customer, never a confirmed delivery date */
  requestedDeliveryDate: string | null;
  requestedShippingMethod: RequestedShippingMethod;
  customerReference: string | null;
  customerNote: string | null;
  items: { materialNumber: string; quantity: number }[];
};

export type SimulationStatus = "VALID" | "VALID_WITH_WARNINGS" | "INVALID";

export type MessageSeverity = "ERROR" | "WARNING" | "INFO";

export type SimulationMessage = {
  severity: MessageSeverity;
  code: string;
  text: string;
  /** The request field or partner role the message is about, if any */
  field?: string;
};

export type SimulationCheck = {
  check: string;
  result: "PASSED" | "FAILED" | "NOT_PERFORMED";
  text?: string;
};

export type SimulatedItem = {
  itemNumber: number;
  materialNumber: string;
  materialDescription: string | null;
  quantity: number;
  unitPrice: string | null;
  netValue: string | null;
  currency: string | null;
  pricing: {
    source: PricingSource;
    /** Condition type of the used price, e.g. ZP01 for the list price */
    conditionType: ConditionTypeSummary | null;
    conditionId: number;
    validFrom: string;
    validTo: string | null;
    steps: PricingStep[];
  } | null;
  messages: SimulationMessage[];
};

export type SimulationPartners = {
  unit: { unitId: string; name: string; isActive: boolean };
  account: PartnerSummary;
  soldTo: PartnerSummary;
  billTo: PartnerSummary;
  payer: PartnerSummary;
  shipTo: (PartnerSummary & { isDefault: boolean }) | null;
};

/** The delivery block a real order WOULD receive; it does not exist yet */
export type ProposedOrderBlock = {
  type: "DELIVERY_BLOCK";
  code: "SALES_REVIEW";
  reason: "CUSTOMER_NOTE";
  description: string;
};

export type SalesOrderSimulation = {
  simulated: true;
  status: SimulationStatus;
  /** The requested sales area */
  salesArea: SalesAreaKey;
  /** Document currency of the sales area; null if it does not exist */
  currency: string | null;
  /** The order date (= pricing date) */
  pricingDate: string;
  requestedDeliveryDate: string | null;
  requestedShippingMethod: RequestedShippingMethod;
  customerReference: string | null;
  customerNote: string | null;
  partners: SimulationPartners | null;
  items: SimulatedItem[];
  /** null for an INVALID simulation: there is never a partial total */
  totals: {
    netValue: string;
    currency: string;
    includes: "NET_EXCL_TAX_AND_FREIGHT";
  } | null;
  requiresSalesReview: boolean;
  proposedOrderBlock: ProposedOrderBlock | null;
  checks: SimulationCheck[];
  /** Header messages; item messages are in the items */
  messages: SimulationMessage[];
};

/** HTTP 200 for every business result, also INVALID; 400 for malformed requests */
export function simulateSalesOrder(request: SimulationRequest) {
  return erpFetch<SalesOrderSimulation>("/sales-orders/simulate", {
    method: "POST",
    body: request,
  });
}
