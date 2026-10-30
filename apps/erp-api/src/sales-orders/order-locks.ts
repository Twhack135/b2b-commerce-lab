import { lockAssignments } from '../customer-sales-areas/assignment-rules';
import { Prisma } from '../generated/prisma/client';
import { SalesAreaKey } from '../sales-areas/sales-area-key';

type Db = Prisma.TransactionClient;

/**
 * Locks (FOR SHARE) everything a new sales order is evaluated from, before
 * it is read, so the order is created from one consistent state. Every
 * writer of this data locks the same rows FOR UPDATE (or updates them) and
 * therefore waits until the order is committed, and the order waits for a
 * writer that came first and then reads its committed result:
 *
 * - the B2B unit: unit updates (partners, ship-tos, status) lock it
 * - the account owner and the partner customers: customer updates change
 *   them, account member replacements lock the owner
 * - their assignments to the sales area: deactivations lock them
 * - the materials: price condition writes and material updates lock them
 *
 * Rows of one kind are locked in a fixed order. Writers lock only one of
 * these rows first and read the others without locks, so the order and a
 * writer cannot wait for each other in a cycle. Missing rows are simply not
 * locked; the evaluation reports them.
 */
export async function lockOrderData(
  db: Db,
  request: {
    unitId: string;
    shipToCustomerNumber: string | null;
    salesArea: SalesAreaKey;
    materialNumbers: string[];
  },
): Promise<void> {
  const [unit] = await db.$queryRaw<
    {
      account_customer_number: string;
      sold_to_customer_number: string;
      bill_to_customer_number: string;
      payer_customer_number: string;
    }[]
  >`
    SELECT account_customer_number, sold_to_customer_number,
           bill_to_customer_number, payer_customer_number
    FROM b2b_units WHERE unit_id = ${request.unitId}
    FOR SHARE`;

  if (unit) {
    // The ship-to list cannot change any more: replacing it needs the unit lock
    const shipTo =
      request.shipToCustomerNumber ??
      (
        await db.b2bUnitShipTo.findFirst({
          where: { unitId: request.unitId, isDefault: true },
          select: { customerNumber: true },
        })
      )?.customerNumber;
    const customers = [
      ...new Set(
        [
          unit.account_customer_number,
          unit.sold_to_customer_number,
          unit.bill_to_customer_number,
          unit.payer_customer_number,
          shipTo,
        ].filter((c): c is string => typeof c === 'string'),
      ),
    ].sort();
    await db.$queryRaw`
      SELECT customer_number FROM customers
      WHERE customer_number = ANY(${customers})
      ORDER BY customer_number
      FOR SHARE`;
    await lockAssignments(db, request.salesArea, customers);
  }

  const materials = [...new Set(request.materialNumbers)].sort();
  await db.$queryRaw`
    SELECT material_number FROM materials
    WHERE material_number = ANY(${materials})
    ORDER BY material_number
    FOR SHARE`;
}
