import { SalesAreaKey } from '../../sales-areas/sales-area-key';

export type ShopUserStatus = 'ACTIVE' | 'DISABLED';
export type ShopUserRole = 'BUYER';

/** A shop user as the internal services return it */
export interface ShopUser {
  id: string;
  accountCustomerNumber: string;
  email: string;
  displayName: string;
  status: ShopUserStatus;
  role: ShopUserRole;
  /** ISO 8601 timestamps */
  createdAt: string;
  updatedAt: string;
}

/**
 * What a user may do with a unit: VIEW its data (e.g. its order history),
 * or ORDER for it. Ordering needs an active unit; viewing does not, so the
 * history of a deactivated unit stays visible to its users.
 */
export type UnitPurpose = 'VIEW' | 'ORDER';

/** A B2B unit a user is authorized for */
export interface AuthorizedUnit {
  unitId: string;
  name: string;
  salesArea: SalesAreaKey;
  /** false while the unit is inactive: viewing only */
  canOrder: boolean;
}
