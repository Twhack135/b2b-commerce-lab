import { SalesAreaAssignment } from '../customer-sales-areas/customer-sales-area.interface';

export interface Customer {
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  isActive: boolean;
  /** Sales areas the customer is assigned to (comparable to SAP KNVV) */
  salesAreas: SalesAreaAssignment[];
}
