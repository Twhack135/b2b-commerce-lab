// Labels, filters and choices of the shop user administration (Sprint 12C).
// Only type imports, so it can be tested directly with `node --test`.

import type { B2bUnit } from "./b2b-units.ts";
import type { CustomerAccount } from "./customer-accounts.ts";
import type {
  ActivationState,
  ShopAccess,
  ShopUserDetail,
  ShopUserSummary,
  UnitAccess,
} from "./shop-users.ts";

export type Tone = "success" | "warning" | "danger" | "neutral" | "info";

export const ACTIVATION_LABELS: Record<ActivationState, { label: string; tone: Tone; hint: string }> = {
  ACTIVATED: { label: "Activated", tone: "success", hint: "The user has set a password." },
  LINK_OPEN: { label: "Link sent", tone: "info", hint: "An activation link is valid and unused." },
  LINK_EXPIRED: { label: "Link expired", tone: "warning", hint: "The last activation link expired unused. Create a new one." },
  NOT_INVITED: { label: "Not invited", tone: "neutral", hint: "No activation link has been created yet." },
};

export const ACCESS_LABELS: Record<ShopAccess, { label: string; tone: Tone; hint: string }> = {
  GRANTED: { label: "Access", tone: "success", hint: "Can sign in and use the assigned units." },
  USER_DISABLED: { label: "Disabled", tone: "danger", hint: "The user is disabled: no sign-in, no access to any unit." },
  ACCOUNT_INACTIVE: {
    label: "Account inactive",
    tone: "danger",
    hint: "The customer account is inactive: none of its shop users can sign in.",
  },
};

export const UNIT_ACCESS_LABELS: Record<UnitAccess, { label: string; tone: Tone; hint: string }> = {
  ORDER: { label: "Can order", tone: "success", hint: "Active unit: viewing and ordering." },
  VIEW: { label: "View only", tone: "warning", hint: "The unit is inactive: its data can be viewed, no new orders." },
  NONE: { label: "No access", tone: "neutral", hint: "The user has no access at the moment." },
};

export type ShopUserFilter = "all" | "access" | "no-access";

/** Search over name, e-mail address and account; filter by current access */
export function filterShopUsers(users: ShopUserSummary[], search: string, filter: ShopUserFilter): ShopUserSummary[] {
  const query = search.trim().toLowerCase();
  return users.filter(
    (user) =>
      (filter === "all" || (user.access === "GRANTED") === (filter === "access")) &&
      [user.displayName, user.email, user.account.customerNumber, user.account.name].some((text) =>
        text.toLowerCase().includes(query),
      ),
  );
}

export function filterCounts(users: ShopUserSummary[]): Record<ShopUserFilter, number> {
  const access = users.filter((user) => user.access === "GRANTED").length;
  return { all: users.length, access, "no-access": users.length - access };
}

/** Accounts a new shop user can belong to: active accounts first, by number */
export function accountChoices(accounts: CustomerAccount[]): CustomerAccount[] {
  return [...accounts].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive) || a.accountCustomerNumber.localeCompare(b.accountCustomerNumber),
  );
}

/**
 * Units of the account that can still be assigned: active and not yet
 * assigned. Units of other accounts are never offered (the ERP refuses
 * them too).
 */
export function assignableUnits(units: B2bUnit[], accountCustomerNumber: string, assigned: string[] = []): B2bUnit[] {
  return units
    .filter(
      (unit) =>
        unit.account.customerNumber === accountCustomerNumber && unit.isActive && !assigned.includes(unit.unitId),
    )
    .sort((a, b) => a.unitId.localeCompare(b.unitId));
}

/** Inactive units of the account, shown as not assignable */
export function inactiveUnits(units: B2bUnit[], accountCustomerNumber: string, assigned: string[] = []): B2bUnit[] {
  return units
    .filter(
      (unit) =>
        unit.account.customerNumber === accountCustomerNumber && !unit.isActive && !assigned.includes(unit.unitId),
    )
    .sort((a, b) => a.unitId.localeCompare(b.unitId));
}

/** Why an activation link cannot be created right now, or null */
export function activationBlocker(user: ShopUserDetail): string | null {
  if (user.activation === "ACTIVATED") return "The user has already set a password.";
  if (user.status === "DISABLED") return "Enable the user before creating an activation link.";
  if (!user.account.isActive) return "The customer account is inactive.";
  return null;
}

/** Why a password reset link cannot be created right now, or null */
export function resetBlocker(user: ShopUserDetail): string | null {
  if (user.activation !== "ACTIVATED") return "The user has not set a password yet: create an activation link instead.";
  if (user.status === "DISABLED") return "Enable the user before creating a password reset link.";
  if (!user.account.isActive) return "The customer account is inactive.";
  return null;
}

/** e.g. "2026-11-20 09:00 UTC", the same everywhere in the Backoffice */
export function formatTimestamp(iso: string): string {
  return `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}
