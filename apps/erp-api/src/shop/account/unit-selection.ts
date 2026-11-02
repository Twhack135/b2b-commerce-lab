// Which B2B unit a signed-in shop user is working with (Sprint 12C,
// docs/adr/0007). The shop remembers the user's choice in a cookie and
// sends it as X-Shop-Unit; that value is only a wish. It is checked here on
// every request against the units the ERP authorizes for the session, so it
// never grants anything by itself.

/** Header with the unit the user chose in the shop (a preference only) */
export const SHOP_UNIT_HEADER = 'x-shop-unit';

export interface SelectableUnit {
  unitId: string;
}

export interface UnitSelection<T extends SelectableUnit> {
  /** The unit to work with, always one of `authorized`, or null */
  unit: T | null;
  /** True if a requested unit is not (or no longer) authorized */
  requestedRejected: boolean;
}

/**
 * The requested unit if the user is authorized for it; otherwise the only
 * authorized unit, if there is exactly one; otherwise none (the user
 * chooses). `authorized` must come from the ERP's authorization check.
 */
export function selectUnit<T extends SelectableUnit>(
  authorized: T[],
  requested: string | undefined,
): UnitSelection<T> {
  const match = requested
    ? authorized.find((unit) => unit.unitId === requested)
    : undefined;
  if (match) return { unit: match, requestedRejected: false };
  return {
    unit: authorized.length === 1 ? authorized[0] : null,
    requestedRejected: requested !== undefined,
  };
}
