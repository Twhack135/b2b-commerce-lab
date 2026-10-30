import { SalesAreaKey } from './sales-area-key';

export interface Currency {
  code: string;
  name: string;
  /** Decimal places of amounts, e.g. 2 for EUR and 0 for JPY */
  decimals: number;
  isActive: boolean;
}

export interface SalesOrganization {
  code: string;
  name: string;
  country: string;
  currency: string;
  isActive: boolean;
}

/** Distribution channel or division */
export interface OrganizationalUnit {
  code: string;
  name: string;
}

/**
 * A sales area with the names of its parts and the currency of its sales
 * organization. isActive is false if the sales area or its sales
 * organization is inactive.
 */
export interface SalesArea extends SalesAreaKey {
  salesOrganizationName: string;
  distributionChannelName: string;
  divisionName: string;
  country: string;
  currency: string;
  currencyDecimals: number;
  isActive: boolean;
}
