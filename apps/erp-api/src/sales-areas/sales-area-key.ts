import { Prisma } from '../generated/prisma/client';

/** A sales area: sales organization / distribution channel / division */
export interface SalesAreaKey {
  salesOrganization: string;
  distributionChannel: string;
  division: string;
}

/** Only the three key fields, e.g. of a unit or an assignment record */
export function salesAreaKeyOf(record: SalesAreaKey): SalesAreaKey {
  return {
    salesOrganization: record.salesOrganization,
    distributionChannel: record.distributionChannel,
    division: record.division,
  };
}

/** Readable form used in messages, e.g. "1000/10/00" */
export function formatSalesArea(key: SalesAreaKey): string {
  return `${key.salesOrganization}/${key.distributionChannel}/${key.division}`;
}

/** Same formats as the CHECK constraints in the migration */
export const SALES_ORGANIZATION_PATTERN = /^[A-Z0-9]{4}$/;
export const SALES_AREA_PART_PATTERN = /^[A-Z0-9]{2}$/;

export function isSalesAreaKey(key: SalesAreaKey): boolean {
  return (
    SALES_ORGANIZATION_PATTERN.test(key.salesOrganization) &&
    SALES_AREA_PART_PATTERN.test(key.distributionChannel) &&
    SALES_AREA_PART_PATTERN.test(key.division)
  );
}

/** Validation message: a unit is used outside its own sales area */
export function unitNotInSalesArea(
  unitId: string,
  unitArea: SalesAreaKey,
  requested: SalesAreaKey,
): string {
  return `unitId ${unitId} belongs to sales area ${formatSalesArea(unitArea)}, not ${formatSalesArea(requested)}`;
}

export function sameSalesArea(a: SalesAreaKey, b: SalesAreaKey): boolean {
  return formatSalesArea(a) === formatSalesArea(b);
}

/**
 * Violations if the sales area is not configured or cannot be used: the
 * sales area and its sales organization must be active. Only listed
 * combinations exist, e.g. 1000/20/00 is rejected although 1000 exists.
 */
export async function checkSalesArea(
  db: Prisma.TransactionClient,
  key: SalesAreaKey,
): Promise<string[]> {
  const area = await db.salesArea.findUnique({
    // Only the key fields: callers may pass larger objects (e.g. a condition key)
    where: {
      salesOrganization_distributionChannel_division: salesAreaKeyOf(key),
    },
    include: { organization: true },
  });
  if (!area) {
    return [`salesArea ${formatSalesArea(key)} does not exist`];
  }
  if (!area.isActive || !area.organization.isActive) {
    return [`salesArea ${formatSalesArea(key)} is inactive`];
  }
  return [];
}

/** A configured sales area with the currency of its sales organization */
export interface SalesAreaWithCurrency {
  key: SalesAreaKey;
  /** The sales area and its sales organization are active */
  isActive: boolean;
  /** Document currency of the sales area, e.g. { code: 'JPY', decimals: 0 } */
  currency: { code: string; decimals: number };
}

/** The sales area with its currency, or null if it is not configured */
export async function findSalesArea(
  db: Prisma.TransactionClient,
  key: SalesAreaKey,
): Promise<SalesAreaWithCurrency | null> {
  if (!isSalesAreaKey(key)) return null;
  const area = await db.salesArea.findUnique({
    // Only the key fields: callers may pass larger objects (e.g. a condition key)
    where: {
      salesOrganization_distributionChannel_division: salesAreaKeyOf(key),
    },
    include: { organization: { include: { currency: true } } },
  });
  if (!area) return null;
  return {
    key: salesAreaKeyOf(area),
    isActive: area.isActive && area.organization.isActive,
    currency: {
      code: area.organization.currency.code,
      decimals: area.organization.currency.decimals,
    },
  };
}

/** Why the sales area cannot be used, as validation messages */
export function salesAreaViolations(
  key: SalesAreaKey,
  area: SalesAreaWithCurrency | null,
): string[] {
  if (!area) {
    return [`salesArea ${formatSalesArea(key)} does not exist`];
  }
  if (!area.isActive) {
    return [`salesArea ${formatSalesArea(key)} is inactive`];
  }
  return [];
}
