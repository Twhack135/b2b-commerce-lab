import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const materials = [
  {
    materialNumber: 'MAT-001',
    description: 'Heat Pump',
    price: '4500.00',
    currency: 'EUR',
  },
  {
    materialNumber: 'MAT-002',
    description: 'Thermostat',
    price: '199.00',
    currency: 'EUR',
  },
];

const customers = [
  {
    customerNumber: 'CUST-0001',
    name: 'Nordwind Heizungsbau GmbH',
    street: 'Hafenstraße 12',
    postalCode: '20457',
    city: 'Hamburg',
    country: 'DE',
    isActive: true,
  },
  {
    customerNumber: 'CUST-0002',
    name: 'Alpen Haustechnik AG',
    street: 'Mariahilfer Straße 88',
    postalCode: '1070',
    city: 'Wien',
    country: 'AT',
    isActive: true,
  },
  {
    customerNumber: 'CUST-0003',
    name: 'Rheinland Sanitär KG',
    street: 'Domstraße 5',
    postalCode: '50667',
    city: 'Köln',
    country: 'DE',
    isActive: false,
  },
  {
    customerNumber: 'CUST-0004',
    name: 'Nordwind Lager Bremen',
    street: 'Überseetor 20',
    postalCode: '28217',
    city: 'Bremen',
    country: 'DE',
    isActive: true,
  },
  {
    customerNumber: 'CUST-0005',
    name: 'Nordwind Zentralbuchhaltung',
    street: 'Hafenstraße 14',
    postalCode: '20457',
    city: 'Hamburg',
    country: 'DE',
    isActive: true,
  },
];

// Customer account CUST-0001 (owner) and its members
const account = {
  owner: 'CUST-0001',
  members: ['CUST-0004', 'CUST-0005'],
};

const b2bUnits = [
  {
    unitId: 'NW-HAMBURG',
    name: 'Nordwind Hamburg',
    soldTo: 'CUST-0001',
    billTo: 'CUST-0005',
    payer: 'CUST-0005',
    shipTos: ['CUST-0001', 'CUST-0004'],
    defaultShipTo: 'CUST-0001',
  },
  {
    unitId: 'NW-BREMEN',
    name: 'Nordwind Lager Bremen',
    soldTo: 'CUST-0001',
    billTo: 'CUST-0005',
    payer: 'CUST-0001',
    shipTos: ['CUST-0004'],
    defaultShipTo: 'CUST-0004',
  },
];

/** Membership row; the owner row points to itself */
function membership(customerNumber: string, accountCustomerNumber: string) {
  return {
    customerNumber,
    accountCustomerNumber,
    accountOwnerRef: accountCustomerNumber,
  };
}

async function main() {
  // upsert = update if the material exists, otherwise insert it.
  // This makes the seed safe to run multiple times.
  for (const material of materials) {
    await prisma.material.upsert({
      where: { materialNumber: material.materialNumber },
      update: material,
      create: material,
    });
  }
  console.log(`Seeded ${materials.length} materials`);

  for (const customer of customers) {
    await prisma.customer.upsert({
      where: { customerNumber: customer.customerNumber },
      update: customer,
      create: customer,
    });
  }
  console.log(`Seeded ${customers.length} customers`);

  // Existing memberships and units are left unchanged (update: {}),
  // so running the seed again never moves customers between accounts
  for (const customerNumber of [account.owner, ...account.members]) {
    await prisma.customerAccountMember.upsert({
      where: { customerNumber },
      update: {},
      create: membership(customerNumber, account.owner),
    });
  }
  console.log(`Seeded customer account ${account.owner}`);

  for (const unit of b2bUnits) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.b2bUnit.findUnique({
        where: { unitId: unit.unitId },
      });
      if (existing) return;

      await tx.b2bUnit.create({
        data: {
          unitId: unit.unitId,
          name: unit.name,
          accountCustomerNumber: account.owner,
          soldToCustomerNumber: unit.soldTo,
          billToCustomerNumber: unit.billTo,
          payerCustomerNumber: unit.payer,
        },
      });
      await tx.b2bUnitShipTo.createMany({
        data: unit.shipTos.map((customerNumber) => ({
          unitId: unit.unitId,
          customerNumber,
          accountCustomerNumber: account.owner,
          isDefault: customerNumber === unit.defaultShipTo,
        })),
      });
    });
  }
  console.log(`Seeded ${b2bUnits.length} B2B units`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
