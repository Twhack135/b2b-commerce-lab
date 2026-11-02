// Derived states of the shop user administration (Sprint 12C), without
// database access. They describe what the authorization checks of the shop
// API do (ShopUsersService, ShopAuthService); they never grant anything.

import {
  ActivationState,
  ShopAccess,
  UnitAccess,
} from './shop-user-admin.interface';

export function activationState(
  credential: { createdAt: Date } | null,
  openLink: { expiresAt: Date } | undefined,
  now: Date,
): ActivationState {
  if (credential) return 'ACTIVATED';
  if (!openLink) return 'NOT_INVITED';
  return openLink.expiresAt > now ? 'LINK_OPEN' : 'LINK_EXPIRED';
}

export function shopAccess(
  status: 'ACTIVE' | 'DISABLED',
  accountIsActive: boolean,
): ShopAccess {
  if (status !== 'ACTIVE') return 'USER_DISABLED';
  return accountIsActive ? 'GRANTED' : 'ACCOUNT_INACTIVE';
}

/** Ordering needs an active unit; an inactive one can only be viewed */
export function unitAccess(
  access: ShopAccess,
  unitIsActive: boolean,
): UnitAccess {
  if (access !== 'GRANTED') return 'NONE';
  return unitIsActive ? 'ORDER' : 'VIEW';
}
