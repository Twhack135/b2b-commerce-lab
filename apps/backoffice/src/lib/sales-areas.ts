import { erpFetch } from "./erp-api";

/** A sales area: sales organization / distribution channel / division */
export type SalesAreaKey = {
  salesOrganization: string;
  distributionChannel: string;
  division: string;
};

/**
 * A sales area as returned by the ERP API, with the currency of its sales
 * organization. Configuration: read-only in the Backoffice.
 */
export type SalesArea = SalesAreaKey & {
  salesOrganizationName: string;
  distributionChannelName: string;
  divisionName: string;
  country: string;
  currency: string;
  /** Decimal places of the currency, e.g. 2 for EUR and 0 for JPY */
  currencyDecimals: number;
  isActive: boolean;
};

/** Assignment of a customer to a sales area (comparable to SAP KNVV) */
export type SalesAreaAssignment = SalesAreaKey & { isActive: boolean };

export function listSalesAreas() {
  return erpFetch<SalesArea[]>("/sales-areas");
}
