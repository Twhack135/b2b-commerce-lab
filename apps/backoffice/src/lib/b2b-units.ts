import { erpFetch } from "./erp-api";
import type { SalesAreaKey } from "./sales-areas";

/** Short view of a customer used as account owner, member or partner */
export type PartnerSummary = {
  customerNumber: string;
  name: string;
  isActive: boolean;
};

export type ShipToAssignment = PartnerSummary & { isDefault: boolean };

/** A B2B unit as returned by the ERP API (see apps/erp-api b2b-units) */
export type B2bUnit = {
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
};

export type CreateB2bUnitInput = SalesAreaKey & {
  unitId: string;
  name: string;
  accountCustomerNumber: string;
  soldToCustomerNumber: string;
  billToCustomerNumber: string;
  payerCustomerNumber: string;
  shipToCustomerNumbers: string[];
  defaultShipToCustomerNumber: string;
  isActive: boolean;
};

/** Unit ID, sales area, account and Sold-to cannot be changed after creation */
export type UpdateB2bUnitInput = Omit<
  CreateB2bUnitInput,
  | "unitId"
  | keyof SalesAreaKey
  | "accountCustomerNumber"
  | "soldToCustomerNumber"
>;

export function listB2bUnits() {
  return erpFetch<B2bUnit[]>("/b2b-units");
}

export function createB2bUnit(input: CreateB2bUnitInput) {
  return erpFetch<B2bUnit>("/b2b-units", { method: "POST", body: input });
}

export function updateB2bUnit(unitId: string, input: UpdateB2bUnitInput) {
  return erpFetch<B2bUnit>(`/b2b-units/${encodeURIComponent(unitId)}`, {
    method: "PATCH",
    body: input,
  });
}
