import { Prisma } from '../generated/prisma/client';
import { findOrderUnit } from './order-unit';

const customer = (customerNumber: string) => ({
  customerNumber,
  name: `Customer ${customerNumber}`,
  street: 'Teststraße 1',
  postalCode: '10115',
  city: 'Berlin',
  country: 'DE',
  isActive: true,
});
const member = (customerNumber: string) => ({
  customerNumber,
  accountCustomerNumber: 'ACC',
  accountOwnerRef: 'ACC',
});
const unit = {
  unitId: 'U1',
  name: 'Unit U1',
  accountCustomerNumber: 'ACC',
  soldToCustomerNumber: 'SOLD',
  billToCustomerNumber: 'BILL',
  payerCustomerNumber: 'ACC',
  isActive: true,
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
};
const shipTo = (customerNumber: string, isDefault = false) => ({
  unitId: 'U1',
  customerNumber,
  accountCustomerNumber: 'ACC',
  isDefault,
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
});

/**
 * A fake transaction client that answers after a tick and records how many
 * queries run at the same time, like queries on one connection would
 */
function fakeDb(data: {
  unit: typeof unit | null;
  shipTos: ReturnType<typeof shipTo>[];
  members: ReturnType<typeof member>[];
  customers: ReturnType<typeof customer>[];
}) {
  const calls: string[] = [];
  let running = 0;
  let maxRunning = 0;
  const query =
    <T>(name: string, result: () => T) =>
    async (args: unknown) => {
      calls.push(`${name} ${JSON.stringify(args)}`);
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setImmediate(resolve));
      running--;
      return result();
    };
  const db = {
    b2bUnit: { findUnique: query('unit', () => data.unit) },
    b2bUnitShipTo: { findMany: query('shipTos', () => data.shipTos) },
    customerAccountMember: { findMany: query('members', () => data.members) },
    customer: { findMany: query('customers', () => data.customers) },
  };
  return {
    db: db as unknown as Prisma.TransactionClient,
    calls,
    maxRunning: () => maxRunning,
  };
}

const complete = () => ({
  unit,
  shipTos: [shipTo('SH1', true), shipTo('SH2')],
  members: ['ACC', 'SOLD', 'BILL', 'SH1', 'SH2'].map(member),
  customers: ['ACC', 'SOLD', 'BILL', 'SH1', 'SH2'].map(customer),
});

describe('findOrderUnit', () => {
  it('returns the unit in the shape of UNIT_INCLUDE', async () => {
    const { db } = fakeDb(complete());
    const result = await findOrderUnit(db, 'U1');
    expect(result).toEqual({
      ...unit,
      soldTo: {
        ...member('SOLD'),
        customer: customer('SOLD'),
        owner: { ...member('ACC'), customer: customer('ACC') },
      },
      billTo: { ...member('BILL'), customer: customer('BILL') },
      payer: { ...member('ACC'), customer: customer('ACC') },
      shipTos: [
        {
          ...shipTo('SH1', true),
          member: { ...member('SH1'), customer: customer('SH1') },
        },
        {
          ...shipTo('SH2'),
          member: { ...member('SH2'), customer: customer('SH2') },
        },
      ],
    });
  });

  it('runs its queries one after the other, never at the same time', async () => {
    const fake = fakeDb(complete());
    await findOrderUnit(fake.db, 'U1');
    expect(fake.maxRunning()).toBe(1);
    expect(fake.calls).toEqual([
      'unit {"where":{"unitId":"U1"}}',
      'shipTos {"where":{"unitId":"U1","accountCustomerNumber":"ACC"},"orderBy":{"customerNumber":"asc"}}',
      'members {"where":{"accountCustomerNumber":"ACC"}}',
      'customers {"where":{"customerNumber":{"in":["ACC","SOLD","BILL","SH1","SH2"]}}}',
    ]);
  });

  it('returns null for an unknown unit after one query', async () => {
    const fake = fakeDb({ ...complete(), unit: null });
    expect(await findOrderUnit(fake.db, 'U1')).toBeNull();
    expect(fake.calls).toHaveLength(1);
  });

  it('fails loudly instead of returning incomplete partners', async () => {
    const data = complete();
    data.customers = data.customers.filter((c) => c.customerNumber !== 'BILL');
    const { db } = fakeDb(data);
    await expect(findOrderUnit(db, 'U1')).rejects.toThrow(
      'Customer BILL is not a member of account ACC of B2B unit U1',
    );
  });
});
