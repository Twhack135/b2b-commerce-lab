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
    'TRUNCATE price_conditions, b2b_unit_ship_tos, b2b_units, customer_account_members, customers, materials RESTART IDENTITY',
  );
}

/**
 * Pricing test data: materials MAT-1 (EUR) and MAT-2 (CHF); account ACC with
 * member M1 and the inactive member OLD; units U1 (Sold-to ACC), U-OFF
 * (inactive) and U-OLD (Sold-to OLD); the customer LONE has no account.
 */
export async function createPricingData(prisma: PrismaService) {
  await prisma.material.createMany({
    data: [
      {
        materialNumber: 'MAT-1',
        description: 'Heat Pump',
        price: '4500.00',
        currency: 'EUR',
      },
      {
        materialNumber: 'MAT-2',
        description: 'Thermostat',
        price: '199.00',
        currency: 'CHF',
      },
    ],
  });
  await createCustomers(prisma, ['ACC', 'M1', 'OLD', 'LONE']);
  await prisma.customerAccountMember.createMany({
    data: ['ACC', 'M1', 'OLD'].map((c) => membership(c, 'ACC')),
  });
  const unit = (unitId: string, soldTo: string, isActive = true) => ({
    unitId,
    name: `Unit ${unitId}`,
    accountCustomerNumber: 'ACC',
    soldToCustomerNumber: soldTo,
    billToCustomerNumber: 'ACC',
    payerCustomerNumber: 'ACC',
    isActive,
  });
  await prisma.b2bUnit.createMany({
    data: [
      unit('U1', 'ACC'),
      unit('U-OFF', 'ACC', false),
      unit('U-OLD', 'OLD'),
    ],
  });
  await prisma.b2bUnitShipTo.createMany({
    data: ['U1', 'U-OFF', 'U-OLD'].map((unitId) => ({
      unitId,
      customerNumber: 'M1',
      accountCustomerNumber: 'ACC',
      isDefault: true,
    })),
  });
  // Deactivated after the unit was created, like in real life
  await prisma.customer.update({
    where: { customerNumber: 'OLD' },
    data: { isActive: false },
  });
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
