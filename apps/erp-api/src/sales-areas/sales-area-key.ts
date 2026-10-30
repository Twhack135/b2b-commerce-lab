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
    where: { salesOrganization_distributionChannel_division: key },
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
