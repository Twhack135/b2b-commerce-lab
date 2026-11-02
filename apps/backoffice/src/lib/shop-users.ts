import { erpFetch } from "./erp-api";
import type { SalesAreaKey } from "./sales-areas";

// Shop users of the customer shop (Sprint 12C), as the ERP admin API
// /shop-users returns them. Local administration only (docs/adr/0007):
// the answers never contain a password or token hash.

export type ShopUserStatus = "ACTIVE" | "DISABLED";

/** Whether the user can use the shop right now, or why not */
export type ShopAccess = "GRANTED" | "USER_DISABLED" | "ACCOUNT_INACTIVE";

export type ActivationState = "ACTIVATED" | "LINK_OPEN" | "LINK_EXPIRED" | "NOT_INVITED";

/** ORDER needs an active unit; VIEW while it is inactive; NONE without access */
export type UnitAccess = "ORDER" | "VIEW" | "NONE";

export type ShopUserSummary = {
  id: string;
  email: string;
  displayName: string;
  status: ShopUserStatus;
  role: "BUYER";
  account: { customerNumber: string; name: string; isActive: boolean };
  access: ShopAccess;
  activation: ActivationState;
  unitCount: number;
  activeSessionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ShopUserUnitAssignment = {
  unitId: string;
  name: string;
  isActive: boolean;
  salesArea: SalesAreaKey;
  access: UnitAccess;
  assignedAt: string;
};

export type ShopUserSession = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  /** When it ends without further activity */
  endsAt: string;
};

export type ShopUserDetail = ShopUserSummary & {
  units: ShopUserUnitAssignment[];
  sessions: ShopUserSession[];
  activationDetails: {
    activatedAt: string | null;
    openLink: { createdAt: string; expiresAt: string } | null;
  };
};

export type CreateShopUserInput = {
  accountCustomerNumber: string;
  email: string;
  displayName: string;
  unitIds: string[];
};

/** Shown exactly once; never stored by the Backoffice */
export type IssuedActivationLink = { activationLink: string; expiresAt: string };

const userPath = (userId: string) => `/shop-users/${encodeURIComponent(userId)}`;

export function listShopUsers() {
  return erpFetch<ShopUserSummary[]>("/shop-users");
}

export function getShopUser(userId: string) {
  return erpFetch<ShopUserDetail>(userPath(userId));
}

export function createShopUser(input: CreateShopUserInput) {
  return erpFetch<ShopUserDetail>("/shop-users", { method: "POST", body: input });
}

export function updateShopUser(userId: string, input: { displayName?: string; status?: ShopUserStatus }) {
  return erpFetch<ShopUserDetail>(userPath(userId), { method: "PATCH", body: input });
}

export function assignShopUserUnit(userId: string, unitId: string) {
  return erpFetch<ShopUserDetail>(`${userPath(userId)}/units/${encodeURIComponent(unitId)}`, { method: "PUT" });
}

export function unassignShopUserUnit(userId: string, unitId: string) {
  return erpFetch<ShopUserDetail>(`${userPath(userId)}/units/${encodeURIComponent(unitId)}`, { method: "DELETE" });
}

export function issueActivationLink(userId: string) {
  return erpFetch<IssuedActivationLink>(`${userPath(userId)}/activation-link`, { method: "POST" });
}

export function revokeShopUserSession(userId: string, sessionId: string) {
  return erpFetch<ShopUserDetail>(`${userPath(userId)}/sessions/${encodeURIComponent(sessionId)}/revoke`, {
    method: "POST",
  });
}

export function revokeAllShopUserSessions(userId: string) {
  return erpFetch<ShopUserDetail>(`${userPath(userId)}/sessions/revoke-all`, { method: "POST" });
}
