import { erpFetch } from "./erp-api";
import type { SalesAreaAssignment, SalesAreaKey } from "./sales-areas";

/** A customer as returned by the ERP API */
export type Customer = {
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  isActive: boolean;
  /** Sales areas the customer is assigned to; changed separately */
  salesAreas: SalesAreaAssignment[];
};

export type CustomerInput = Omit<Customer, "salesAreas">;

export type CustomerChanges = Omit<CustomerInput, "customerNumber">;

/** A single assignment, as returned after creating or changing it */
export type CustomerSalesArea = SalesAreaAssignment & { customerNumber: string };

export function listCustomers() {
  return erpFetch<Customer[]>("/customers");
}

export function createCustomer(customer: CustomerInput) {
  return erpFetch<Customer>("/customers", { method: "POST", body: customer });
}

export function updateCustomer(
  customerNumber: string,
  changes: CustomerChanges,
) {
  return erpFetch<Customer>(`/customers/${encodeURIComponent(customerNumber)}`, {
    method: "PATCH",
    body: changes,
  });
}

/** Assigns the customer to a sales area (the assignment is active) */
export function assignCustomerSalesArea(
  customerNumber: string,
  salesArea: SalesAreaKey,
) {
  return erpFetch<CustomerSalesArea>(
    `/customers/${encodeURIComponent(customerNumber)}/sales-areas`,
    {
      method: "POST",
      body: {
        salesOrganization: salesArea.salesOrganization,
        distributionChannel: salesArea.distributionChannel,
        division: salesArea.division,
      },
    },
  );
}

/** Activates or deactivates an existing assignment */
export function setCustomerSalesAreaActive(
  customerNumber: string,
  salesArea: SalesAreaKey,
  isActive: boolean,
) {
  const path = [
    salesArea.salesOrganization,
    salesArea.distributionChannel,
    salesArea.division,
  ]
    .map(encodeURIComponent)
    .join("/");
  return erpFetch<CustomerSalesArea>(
    `/customers/${encodeURIComponent(customerNumber)}/sales-areas/${path}`,
    { method: "PATCH", body: { isActive } },
  );
}
