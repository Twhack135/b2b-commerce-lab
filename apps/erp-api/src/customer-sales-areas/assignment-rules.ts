import { Prisma } from '../generated/prisma/client';
import { SalesAreaKey } from '../sales-areas/sales-area-key';

type Db = Prisma.TransactionClient;

/**
 * Locks the assignments of the given customers to the sales area until the
 * transaction ends (FOR SHARE) and returns whether each one is active.
 * Customers without an assignment are missing from the result.
 *
 * Every write that relies on an active assignment (creating a unit, adding
 * a partner, reactivating a unit) takes this lock. Deactivating an
 * assignment locks the same row FOR UPDATE, so both can never overlap: a
 * deactivation either sees the new unit and is refused, or the unit sees
 * the inactive assignment and is refused. Rows are locked in a fixed order,
 * so two such writes cannot deadlock each other.
 */
export async function lockAssignments(
  db: Db,
  key: SalesAreaKey,
  customerNumbers: string[],
): Promise<Map<string, boolean>> {
  const numbers = [...new Set(customerNumbers)];
  if (numbers.length === 0) return new Map();
  const rows = await db.$queryRaw<
    { customer_number: string; is_active: boolean }[]
  >`
    SELECT customer_number, is_active FROM customer_sales_areas
    WHERE customer_number = ANY(${numbers})
      AND sales_organization = ${key.salesOrganization}
      AND distribution_channel = ${key.distributionChannel}
      AND division = ${key.division}
    ORDER BY customer_number
    FOR SHARE`;
  return new Map(rows.map((row) => [row.customer_number, row.is_active]));
}

/**
 * Active B2B units in the sales area that use the customer as Sold-to,
 * Bill-to, Payer or Ship-to. Inactive units do not count: they are checked
 * again when they are reactivated.
 */
export async function findDependentUnits(
  db: Db,
  customerNumber: string,
  key: SalesAreaKey,
): Promise<string[]> {
  const units = await db.b2bUnit.findMany({
    where: {
      ...key,
      isActive: true,
      OR: [
        { soldToCustomerNumber: customerNumber },
        { billToCustomerNumber: customerNumber },
        { payerCustomerNumber: customerNumber },
        { shipTos: { some: { customerNumber } } },
      ],
    },
    select: { unitId: true },
    orderBy: { unitId: 'asc' },
  });
  return units.map((unit) => unit.unitId);
}
