import { SalesAreaKey } from '../sales-areas/sales-area-key';
import {
  ShopUserRole,
  ShopUserStatus,
} from '../shop/users/shop-user.interface';

// Contracts of the local shop user administration (Sprint 12C) for the
// Backoffice. They never contain password hashes, token hashes or tokens;
// the only secret ever returned is a new activation link, exactly once.

/**
 * Where the user stands with the first password:
 * ACTIVATED      the user has set a password
 * LINK_OPEN      an unused activation link is valid
 * LINK_EXPIRED   the last link expired unused
 * NOT_INVITED    no link was ever issued
 */
export type ActivationState =
  'ACTIVATED' | 'LINK_OPEN' | 'LINK_EXPIRED' | 'NOT_INVITED';

/**
 * Whether the user can use the shop right now: GRANTED for an active user
 * of an active account, otherwise the reason (the user is disabled is
 * checked first).
 */
export type ShopAccess = 'GRANTED' | 'USER_DISABLED' | 'ACCOUNT_INACTIVE';

/** What the user may do with an assigned unit right now */
export type UnitAccess = 'ORDER' | 'VIEW' | 'NONE';

export interface ShopUserSummary {
  id: string;
  email: string;
  displayName: string;
  status: ShopUserStatus;
  role: ShopUserRole;
  account: { customerNumber: string; name: string; isActive: boolean };
  access: ShopAccess;
  activation: ActivationState;
  unitCount: number;
  activeSessionCount: number;
  /** ISO 8601 timestamps */
  createdAt: string;
  updatedAt: string;
}

export interface ShopUserUnitAssignment {
  unitId: string;
  name: string;
  isActive: boolean;
  salesArea: SalesAreaKey;
  /** ORDER needs an active unit; VIEW only while it is inactive */
  access: UnitAccess;
  assignedAt: string;
}

/** A session that is open now; never its token or token hash */
export interface ShopUserSessionInfo {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  /** When it ends without further activity (idle or absolute limit) */
  endsAt: string;
}

export interface ShopUserDetail extends ShopUserSummary {
  units: ShopUserUnitAssignment[];
  sessions: ShopUserSessionInfo[];
  activationDetails: {
    /** When the password was set */
    activatedAt: string | null;
    /** The current unused link, if any (its token is never shown again) */
    openLink: { createdAt: string; expiresAt: string } | null;
  };
}

/** The one and only time the activation link is shown */
export interface IssuedActivationLink {
  activationLink: string;
  expiresAt: string;
}
