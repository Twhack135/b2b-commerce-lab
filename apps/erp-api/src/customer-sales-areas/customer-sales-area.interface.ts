import { SalesAreaKey } from '../sales-areas/sales-area-key';

/** Assignment of a customer to a sales area, as listed with the customer */
export interface SalesAreaAssignment extends SalesAreaKey {
  isActive: boolean;
}

/** A single assignment, as returned after creating or changing it */
export interface CustomerSalesArea extends SalesAreaAssignment {
  customerNumber: string;
}
