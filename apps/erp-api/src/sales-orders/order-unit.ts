import { Prisma } from '../generated/prisma/client';
import { SimulationUnit } from './simulation-rules';

type Db = Prisma.TransactionClient;

/**
 * The B2B unit with its partners, in exactly the shape of UNIT_INCLUDE
 * (Sold-to with account owner, Bill-to, Payer, Ship-tos ordered by customer
 * number, each with its customer), or null if the unit does not exist.
 *
 * The relations are loaded one query after the other instead of with
 * `include`: for an include, Prisma runs the queries of sibling relations at
 * the same time (Promise.all). Inside an interactive transaction all
 * queries share one connection, so pg had to queue them and warned that
 * this is deprecated ("client.query() when the client is already executing
 * a query", removed in pg 9). The data read is the same.
 */
export async function findOrderUnit(
  db: Db,
  unitId: string,
): Promise<SimulationUnit | null> {
  const unit = await db.b2bUnit.findUnique({ where: { unitId } });
  if (!unit) return null;

  const account = unit.accountCustomerNumber;
  const shipTos = await db.b2bUnitShipTo.findMany({
    where: { unitId, accountCustomerNumber: account },
    orderBy: { customerNumber: 'asc' },
  });
  // All partners of a unit are members of its account (foreign keys)
  const members = await db.customerAccountMember.findMany({
    where: { accountCustomerNumber: account },
  });
  const customers = await db.customer.findMany({
    where: { customerNumber: { in: members.map((m) => m.customerNumber) } },
  });

  const withCustomer = (customerNumber: string) => {
    const memberRow = members.find((m) => m.customerNumber === customerNumber);
    const customer = customers.find((c) => c.customerNumber === customerNumber);
    if (!memberRow || !customer) {
      // Impossible while the foreign keys exist
      throw new Error(
        `Customer ${customerNumber} is not a member of account ${account} of B2B unit ${unitId}`,
      );
    }
    return { ...memberRow, customer };
  };

  const soldTo = withCustomer(unit.soldToCustomerNumber);
  return {
    ...unit,
    soldTo: { ...soldTo, owner: withCustomer(soldTo.accountOwnerRef) },
    billTo: withCustomer(unit.billToCustomerNumber),
    payer: withCustomer(unit.payerCustomerNumber),
    shipTos: shipTos.map((shipTo) => ({
      ...shipTo,
      member: withCustomer(shipTo.customerNumber),
    })),
  };
}
