import type { PartnerSummary } from "./b2b-units";
import { erpFetch } from "./erp-api";

/**
 * A customer account. For now it is represented by its owner, an existing
 * Customer Master record; members are other customers of the account.
 */
export type CustomerAccount = {
  accountCustomerNumber: string;
  name: string;
  isActive: boolean;
  /** Other customers of the account; the owner is not listed here */
  members: PartnerSummary[];
};

export function listCustomerAccounts() {
  return erpFetch<CustomerAccount[]>("/customer-accounts");
}

export function getCustomerAccount(accountCustomerNumber: string) {
  return erpFetch<CustomerAccount>(
    `/customer-accounts/${encodeURIComponent(accountCustomerNumber)}`,
  );
}

/** Replaces the complete member list; creates the account if needed */
export function replaceAccountMembers(
  accountCustomerNumber: string,
  memberCustomerNumbers: string[],
) {
  return erpFetch<CustomerAccount>(
    `/customer-accounts/${encodeURIComponent(accountCustomerNumber)}/members`,
    { method: "PUT", body: { memberCustomerNumbers } },
  );
}
