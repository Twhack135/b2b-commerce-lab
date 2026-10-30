import { PartnerSummary } from '../common/partner-summary';
import { SalesAreaKey } from '../sales-areas/sales-area-key';

export interface ShipToAssignment extends PartnerSummary {
  isDefault: boolean;
}

/**
 * A B2B unit with its partner functions:
 * Sold-to (SP), Bill-to (BP), Payer (PY) and allowed Ship-tos (SH).
 * Partner summaries include isActive, so clients can warn about partners
 * that became inactive after they were assigned.
 */
export interface B2bUnit {
  unitId: string;
  name: string;
  isActive: boolean;
  /** The sales area the unit orders in; fixed after creation */
  salesArea: SalesAreaKey;
  account: PartnerSummary;
  soldTo: PartnerSummary;
  billTo: PartnerSummary;
  payer: PartnerSummary;
  shipTos: ShipToAssignment[];
  defaultShipToCustomerNumber: string;
}
