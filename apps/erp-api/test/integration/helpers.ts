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

/**
 * Data shaped like the development data: account CUST-1000 (Müller
 * Heiztechnik GmbH, Sold-to, Bill-to and Payer) with warehouses CUST-1100
 * (Stuttgart) and CUST-1200 (München); units UNIT-STUTTGART (default Ship-to
 * CUST-1100) and UNIT-MUENCHEN (default Ship-to CUST-1200); prices for
 * MAT-002: Sold-to CUST-1000 189.50, unit UNIT-MUENCHEN 179.00 from
 * 2026-06-15. CUST-2000 is a customer of no account.
 */
export async function createMuellerData(prisma: PrismaService) {
  await prisma.material.createMany({
    data: [
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
      {
        materialNumber: 'MAT-CH',
        description: 'Swiss Valve',
        price: '25.00',
        currency: 'CHF',
      },
    ],
  });
  await createCustomers(prisma, [
    'CUST-1000',
    'CUST-1100',
    'CUST-1200',
    'CUST-2000',
  ]);
  await prisma.customerAccountMember.createMany({
    data: ['CUST-1000', 'CUST-1100', 'CUST-1200'].map((c) =>
      membership(c, 'CUST-1000'),
    ),
  });
  const unit = (unitId: string, billTo = 'CUST-1000') => ({
    unitId,
    name: `Müller ${unitId}`,
    accountCustomerNumber: 'CUST-1000',
    soldToCustomerNumber: 'CUST-1000',
    billToCustomerNumber: billTo,
    payerCustomerNumber: 'CUST-1000',
  });
  await prisma.b2bUnit.createMany({
    data: [unit('UNIT-STUTTGART'), unit('UNIT-MUENCHEN')],
  });
  const shipTo = (
    unitId: string,
    customerNumber: string,
    isDefault = false,
  ) => ({
    unitId,
    customerNumber,
    accountCustomerNumber: 'CUST-1000',
    isDefault,
  });
  await prisma.b2bUnitShipTo.createMany({
    data: [
      shipTo('UNIT-STUTTGART', 'CUST-1000'),
      shipTo('UNIT-STUTTGART', 'CUST-1100', true),
      shipTo('UNIT-STUTTGART', 'CUST-1200'),
      shipTo('UNIT-MUENCHEN', 'CUST-1100'),
      shipTo('UNIT-MUENCHEN', 'CUST-1200', true),
    ],
  });
  await prisma.priceCondition.createMany({
    data: [
      {
        materialNumber: 'MAT-002',
        scope: 'SOLD_TO',
        soldToCustomerNumber: 'CUST-1000',
        amount: '189.50',
        currency: 'EUR',
        validFrom: new Date('2026-01-01T00:00:00Z'),
      },
      {
        materialNumber: 'MAT-002',
        scope: 'B2B_UNIT',
        unitId: 'UNIT-MUENCHEN',
        amount: '179.00',
        currency: 'EUR',
        validFrom: new Date('2026-06-15T00:00:00Z'),
      },
    ],
  });
}

/** Row count and content checksum of every table, to prove nothing changed */
export async function tableFingerprint(prisma: PrismaService) {
  const tables = [
    'materials',
    'customers',
    'customer_account_members',
    'b2b_units',
    'b2b_unit_ship_tos',
    'price_conditions',
  ];
  const result: Record<string, string> = {};
  for (const table of tables) {
    // Table names are fixed above, never user input
    const [row] = await prisma.$queryRawUnsafe<
      { count: bigint; hash: string }[]
    >(
      `SELECT count(*) AS count, md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) AS hash FROM ${table} t`,
    );
    result[table] = `${row.count}:${row.hash}`;
  }
  return result;
}
