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
];

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
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
