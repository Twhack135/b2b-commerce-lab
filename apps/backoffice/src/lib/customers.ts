import { erpFetch } from "./erp-api";

/** A customer as returned by the ERP API */
export type Customer = {
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  isActive: boolean;
};

export type CustomerChanges = Omit<Customer, "customerNumber">;

export function listCustomers() {
  return erpFetch<Customer[]>("/customers");
}

export function createCustomer(customer: Customer) {
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
