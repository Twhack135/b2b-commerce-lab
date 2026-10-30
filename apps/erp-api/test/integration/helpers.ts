import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { Clock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * The German sales area, configured by the migration like the other sales
 * areas (2000/10/00 Poland, 3000/10/00 Japan). Test customers are assigned
 * to it, like all customers that existed before Sprint 9C-A.
 */
export const GERMANY = {
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
};
export const POLAND = { ...GERMANY, salesOrganization: '2000' };
export const JAPAN = { ...GERMANY, salesOrganization: '3000' };

/**
 * The real application, configured exactly like in main.ts. Pass `clock`
 * to control "now", e.g. the order date of sales orders around midnight.
 */
export async function createTestApp(options: { clock?: TestClock } = {}) {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.clock) {
    builder = builder.overrideProvider(Clock).useValue(options.clock);
  }
  const moduleRef = await builder.compile();
  const app: INestApplication<App> = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  const http = () => request(app.getHttpServer());
  return { app, prisma, http };
}

/** A clock whose time a test sets; starts at the given instant */
export class TestClock {
  constructor(private instant: Date) {}

  now(): Date {
    return this.instant;
  }

  set(iso: string) {
    this.instant = new Date(iso);
  }
}

/**
 * Removes all business data. Refuses to run on anything but a *_test
 * database. Configuration from the migrations (condition types, currencies,
 * sales areas) is kept.
 */
export async function resetDatabase(prisma: PrismaService) {
  const [{ name }] = await prisma.$queryRaw<{ name: string }[]>`
    SELECT current_database() AS name`;
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to delete data in database ${name}`);
  }
  await prisma.$executeRawUnsafe(
    'TRUNCATE sales_order_item_conditions, sales_order_items, sales_order_partners, sales_orders, price_conditions, b2b_unit_ship_tos, b2b_units, customer_sales_areas, customer_account_members, customers, materials RESTART IDENTITY',
  );
  // Sales order numbers start again at 1000000001
  await prisma.$executeRawUnsafe(
    'ALTER SEQUENCE sales_order_number_seq RESTART',
  );
}

/**
 * List prices (ZP01) of the test data get fixed IDs from this number on,
 * far above the IDs the sequence hands out, so conditions created by a test
 * are still numbered 1, 2, 3, ...
 */
export const LIST_PRICE_ID = 9001;

/**
 * ZP01 list prices of materials in a sales area, valid from 1900-01-01 and
 * open-ended, like the list prices created by the Sprint 9C-B migration.
 */
export async function createListPrices(
  prisma: PrismaService,
  salesArea: typeof GERMANY,
  currency: string,
  prices: [materialNumber: string, amount: string][],
  firstId = LIST_PRICE_ID,
) {
  await prisma.priceCondition.createMany({
    data: prices.map(([materialNumber, amount], index) => ({
      conditionId: firstId + index,
      conditionTypeCode: 'ZP01',
      ...salesArea,
      materialNumber,
      scope: 'SALES_AREA' as const,
      amount,
      currency,
      validFrom: new Date('1900-01-01T00:00:00Z'),
    })),
  });
}

/**
 * Pricing test data: material MAT-1 with the German list price 4500.00 EUR
 * (ZP01, condition 9001) and MAT-2 with a list price only in Poland
 * (799.00 PLN, condition 9002), so it has no price in Germany; account ACC
 * with member M1 and the inactive member OLD; units U1 (Sold-to ACC), U-OFF
 * (inactive) and U-OLD (Sold-to OLD); the customer LONE has no account.
 */
export async function createPricingData(prisma: PrismaService) {
  await prisma.material.createMany({
    data: [
      { materialNumber: 'MAT-1', description: 'Heat Pump' },
      { materialNumber: 'MAT-2', description: 'Thermostat' },
    ],
  });
  await createListPrices(prisma, GERMANY, 'EUR', [['MAT-1', '4500.00']]);
  await createListPrices(prisma, POLAND, 'PLN', [['MAT-2', '799.00']], 9002);
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
    ...GERMANY,
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
      ...GERMANY,
    })),
  });
  // Deactivated after the unit was created, like in real life
  await prisma.customer.update({
    where: { customerNumber: 'OLD' },
    data: { isActive: false },
  });
}

/**
 * Creates test customers; all active unless listed in `inactive`. Each one
 * is assigned (actively) to the German sales area.
 */
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
  await prisma.customerSalesArea.createMany({
    data: customerNumbers.map((customerNumber) => ({
      customerNumber,
      ...GERMANY,
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
 * CUST-1100) and UNIT-MUENCHEN (default Ship-to CUST-1200), all in the German
 * sales area; list prices (ZP01) MAT-001 4500.00 and MAT-002 199.00 EUR
 * (conditions 9001 and 9002); prices for MAT-002: Sold-to CUST-1000 189.50,
 * unit UNIT-MUENCHEN 179.00 from 2026-06-15. MAT-PL only has a Polish list
 * price, so it has no price in Germany. CUST-2000 is a customer of no account.
 */
export async function createMuellerData(prisma: PrismaService) {
  await prisma.material.createMany({
    data: [
      { materialNumber: 'MAT-001', description: 'Heat Pump' },
      { materialNumber: 'MAT-002', description: 'Thermostat' },
      { materialNumber: 'MAT-PL', description: 'Polish Valve' },
    ],
  });
  await createListPrices(prisma, GERMANY, 'EUR', [
    ['MAT-001', '4500.00'],
    ['MAT-002', '199.00'],
  ]);
  await createListPrices(prisma, POLAND, 'PLN', [['MAT-PL', '99.00']], 9003);
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
    ...GERMANY,
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
    ...GERMANY,
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
        conditionTypeCode: 'ZP02',
        ...GERMANY,
        materialNumber: 'MAT-002',
        scope: 'SOLD_TO',
        soldToCustomerNumber: 'CUST-1000',
        amount: '189.50',
        currency: 'EUR',
        validFrom: new Date('2026-01-01T00:00:00Z'),
      },
      {
        conditionTypeCode: 'ZP02',
        ...GERMANY,
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
    'customer_sales_areas',
    'b2b_units',
    'b2b_unit_ship_tos',
    'price_conditions',
    'sales_orders',
    'sales_order_partners',
    'sales_order_items',
    'sales_order_item_conditions',
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
