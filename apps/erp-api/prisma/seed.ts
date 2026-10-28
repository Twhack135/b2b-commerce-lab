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
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
