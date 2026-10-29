// Logic for managing customer account members.
// Mirrors the ERP API rules (apps/erp-api/src/customer-accounts):
// a customer belongs to at most one account, an owner cannot be a member of
// another account, and new members must be active.
// Only type imports, so it can be tested directly with `node --test`.
import type { PartnerSummary } from "./b2b-units.ts";
import type { CustomerAccount } from "./customer-accounts.ts";

export type MemberStatus =
  | "member" // already a member of this account
  | "available" // active and in no account
  | "inactive" // inactive and not a member: cannot be added
  | "owner-of-other" // owns another account
  | "member-of-other"; // member of another account

export type MemberCandidate = PartnerSummary & {
  status: MemberStatus;
  /** The other account, for owner-of-other and member-of-other */
  otherAccount?: string;
  /** Can be checked or unchecked in the member list */
  isSelectable: boolean;
};

/** Where each customer currently belongs: account number per customer */
function accountOf(accounts: CustomerAccount[]) {
  const owners = new Set(accounts.map((a) => a.accountCustomerNumber));
  const memberOf = new Map<string, string>();
  for (const account of accounts) {
    for (const member of account.members) {
      memberOf.set(member.customerNumber, account.accountCustomerNumber);
    }
  }
  return { owners, memberOf };
}

/**
 * All customers except the owner, with whether they can be members of the
 * given account. Customers of other accounts are shown but cannot be chosen.
 */
export function memberCandidates(
  customers: PartnerSummary[],
  accounts: CustomerAccount[],
  accountCustomerNumber: string,
): MemberCandidate[] {
  const { owners, memberOf } = accountOf(accounts);

  return customers
    .filter((c) => c.customerNumber !== accountCustomerNumber)
    .map((customer): MemberCandidate => {
      const summary = {
        customerNumber: customer.customerNumber,
        name: customer.name,
        isActive: customer.isActive,
      };
      const other = memberOf.get(customer.customerNumber);
      if (other === accountCustomerNumber) {
        return { ...summary, status: "member", isSelectable: true };
      }
      if (owners.has(customer.customerNumber)) {
        return {
          ...summary,
          status: "owner-of-other",
          otherAccount: customer.customerNumber,
          isSelectable: false,
        };
      }
      if (other) {
        return { ...summary, status: "member-of-other", otherAccount: other, isSelectable: false };
      }
      if (!customer.isActive) {
        return { ...summary, status: "inactive", isSelectable: false };
      }
      return { ...summary, status: "available", isSelectable: true };
    });
}

export type OwnerOption = PartnerSummary & {
  /** True if the customer already owns an account */
  hasAccount: boolean;
};

/**
 * Customers that can own an account: existing owners, plus active customers
 * that belong to no account yet (choosing one creates a new account).
 */
export function ownerOptions(
  customers: PartnerSummary[],
  accounts: CustomerAccount[],
): OwnerOption[] {
  const { owners, memberOf } = accountOf(accounts);
  return customers
    .filter(
      (c) =>
        owners.has(c.customerNumber) ||
        (!memberOf.has(c.customerNumber) && c.isActive),
    )
    .map((c) => ({
      customerNumber: c.customerNumber,
      name: c.name,
      isActive: c.isActive,
      hasAccount: owners.has(c.customerNumber),
    }));
}

/** Text explaining why a candidate cannot be chosen */
export function candidateNote(candidate: MemberCandidate): string | undefined {
  switch (candidate.status) {
    case "owner-of-other":
      return "Owns its own account";
    case "member-of-other":
      return `Member of account ${candidate.otherAccount}`;
    case "inactive":
      return "Inactive customers cannot be added";
    case "member":
      return candidate.isActive ? undefined : "Inactive – kept as member";
    default:
      return undefined;
  }
}

/** Checks the selection before it is sent to the ERP API */
export function validateMemberSelection(
  selected: string[],
  candidates: MemberCandidate[],
): string | undefined {
  for (const customerNumber of selected) {
    const candidate = candidates.find((c) => c.customerNumber === customerNumber);
    if (!candidate) return `${customerNumber} cannot be a member of this account.`;
    if (!candidate.isSelectable) {
      return `${customerNumber} cannot be added: ${candidateNote(candidate)?.toLowerCase()}.`;
    }
  }
  return undefined;
}

/**
 * Error messages of the ERP API per customer, e.g.
 * "memberCustomerNumbers CUST-4 is still used as a partner in B2B unit X".
 */
export function memberErrors(messages: string[]): Map<string, string> {
  const errors = new Map<string, string>();
  for (const message of messages) {
    // The customer number is followed by "is ...", "does ..." or "owns ...";
    // other messages such as "memberCustomerNumbers must not contain ..."
    // are not about a single customer
    const match = /^memberCustomerNumbers (\S+) ((?:is|does|owns) .*)$/.exec(
      message,
    );
    if (match && !errors.has(match[1])) {
      errors.set(match[1], `${match[1]} ${match[2]}.`);
    }
  }
  return errors;
}
