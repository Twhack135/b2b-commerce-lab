import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';

/** The real application, configured exactly like in main.ts */
export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app: INestApplication<App> = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  const http = () => request(app.getHttpServer());
  return { app, prisma, http };
}

/** Removes all rows. Refuses to run on anything but a *_test database. */
export async function resetDatabase(prisma: PrismaService) {
  const [{ name }] = await prisma.$queryRaw<{ name: string }[]>`
    SELECT current_database() AS name`;
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to delete data in database ${name}`);
  }
  await prisma.$executeRawUnsafe(
    'TRUNCATE b2b_unit_ship_tos, b2b_units, customer_account_members, customers, materials',
  );
}

/** Creates test customers; all active unless listed in `inactive` */
export async function createCustomers(
  prisma: PrismaService,
  customerNumbers: string[],
  inactive: string[] = [],
) {
  await prisma.customer.createMany({
    data: customerNumbers.map((customerNumber) => ({
      customerNumber,
      name: `Customer ${customerNumber}`,
      street: 'Teststraße 1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
      isActive: !inactive.includes(customerNumber),
    })),
  });
}

/** Membership row; the owner row points to itself */
export function membership(
  customerNumber: string,
  accountCustomerNumber: string,
) {
  return {
    customerNumber,
    accountCustomerNumber,
    accountOwnerRef: accountCustomerNumber,
  };
}
