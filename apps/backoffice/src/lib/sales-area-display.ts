// Display and lookup helpers for sales areas and customer assignments.
// Only type imports, so it can be tested directly with `node --test`.
import type {
  SalesArea,
  SalesAreaAssignment,
  SalesAreaKey,
} from "./sales-areas.ts";

/**
 * The German sales area, the default context where a page needs one. A user
 * selection is never changed to it automatically.
 */
export const DEFAULT_SALES_AREA_ID = "1000/10/00";

/** Compact key used in form values and messages, e.g. "1000/10/00" */
export function salesAreaId(key: SalesAreaKey): string {
  return `${key.salesOrganization}/${key.distributionChannel}/${key.division}`;
}

/** The key of an id from salesAreaId, or null for any other text */
export function parseSalesAreaId(id: string): SalesAreaKey | null {
  const match = /^([A-Z0-9]{4})\/([A-Z0-9]{2})\/([A-Z0-9]{2})$/.exec(id);
  if (!match) return null;
  return {
    salesOrganization: match[1],
    distributionChannel: match[2],
    division: match[3],
  };
}

export function sameSalesArea(a: SalesAreaKey, b: SalesAreaKey): boolean {
  return salesAreaId(a) === salesAreaId(b);
}

export function findSalesArea(
  areas: SalesArea[] | null | undefined,
  key: SalesAreaKey,
): SalesArea | undefined {
  return areas?.find((area) => sameSalesArea(area, key));
}

/** "1000 / 10 / 00 – B2B Lab Germany (EUR)" */
export function salesAreaLabel(area: SalesArea): string {
  const codes = `${area.salesOrganization} / ${area.distributionChannel} / ${area.division}`;
  return `${codes} – ${area.salesOrganizationName} (${area.currency})`;
}

/** Name of the sales organization, or the key if the area is unknown */
export function salesAreaName(
  areas: SalesArea[] | null | undefined,
  key: SalesAreaKey,
): string {
  return findSalesArea(areas, key)?.salesOrganizationName ?? salesAreaId(key);
}

/**
 * Status of a customer in a sales area: "active", "inactive" (assigned but
 * deactivated) or "missing" (not assigned)
 */
export type AssignmentStatus = "active" | "inactive" | "missing";

export function assignmentStatus(
  assignments: SalesAreaAssignment[],
  key: SalesAreaKey,
): AssignmentStatus {
  const assignment = assignments.find((a) => sameSalesArea(a, key));
  if (!assignment) return "missing";
  return assignment.isActive ? "active" : "inactive";
}

/** Active sales areas the customer is not assigned to yet */
export function assignableSalesAreas(
  areas: SalesArea[],
  assignments: SalesAreaAssignment[],
): SalesArea[] {
  return areas.filter(
    (area) =>
      area.isActive && !assignments.some((a) => sameSalesArea(a, area)),
  );
}

/** The sales area of a compact id, if configured */
export function salesAreaById(
  areas: SalesArea[] | null | undefined,
  id: string,
): SalesArea | undefined {
  const key = parseSalesAreaId(id);
  return key ? findSalesArea(areas, key) : undefined;
}

/**
 * Decimal places of a currency as configured in the ERP API (via the sales
 * areas), e.g. 0 for JPY; undefined if no sales area uses the currency
 */
export function currencyDecimals(
  areas: SalesArea[] | null | undefined,
  currency: string,
): number | undefined {
  return areas?.find((area) => area.currency === currency)?.currencyDecimals;
}

/** Items that belong to the sales area, e.g. the B2B units of a market */
export function inSalesArea<T extends { salesArea: SalesAreaKey }>(
  items: T[],
  id: string,
): T[] {
  return items.filter((item) => salesAreaId(item.salesArea) === id);
}
