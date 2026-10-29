// These tests talk to the database directly, bypassing the services, to prove
// which rules PostgreSQL itself enforces.
import { spawnSync } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createCustomers,
  createTestApp,
  membership,
  resetDatabase,
} from './helpers';

describe('Database constraints (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createCustomers(prisma, ['A', 'B', 'X', 'Y', 'Z']);
    // Accounts A and B, X is a member of A
    await prisma.customerAccountMember.createMany({
      data: [membership('A', 'A'), membership('B', 'B'), membership('X', 'A')],
    });
  });

  const insertMember = (customer: string, account: string) =>
    prisma.customerAccountMember.create({
      data: membership(customer, account),
    });

  const createUnit = (overrides: Record<string, string> = {}) =>
    prisma.b2bUnit.create({
      data: {
        unitId: 'U1',
        name: 'Unit 1',
        accountCustomerNumber: 'A',
        soldToCustomerNumber: 'A',
        billToCustomerNumber: 'A',
        payerCustomerNumber: 'X',
        ...overrides,
      },
    });

  const addShipTo = (customer: string, isDefault: boolean, account = 'A') =>
    prisma.b2bUnitShipTo.create({
      data: {
        unitId: 'U1',
        customerNumber: customer,
        accountCustomerNumber: account,
        isDefault,
      },
    });

  describe('customer account membership', () => {
    it('allows an owner row and member rows', async () => {
      await expect(insertMember('Y', 'A')).resolves.toBeDefined();
    });

    it('rejects a customer in two accounts (primary key)', async () => {
      await expect(insertMember('X', 'B')).rejects.toThrow(/Unique constraint/);
    });

    it('rejects an owner becoming a member of another account (primary key)', async () => {
      await expect(insertMember('A', 'B')).rejects.toThrow(/Unique constraint/);
    });

    it('rejects a member owning another account: no nesting, no cycles (foreign key)', async () => {
      // X is a member of A, so X cannot be the account of Y
      await expect(insertMember('Y', 'X')).rejects.toThrow(
        /Foreign key constraint/,
      );
    });

    it('rejects an account that does not exist (foreign key)', async () => {
      await expect(insertMember('Y', 'Z')).rejects.toThrow(
        /Foreign key constraint/,
      );
    });

    it('rejects a membership for an unknown customer (foreign key)', async () => {
      await expect(insertMember('GHOST', 'A')).rejects.toThrow(
        /Foreign key constraint/,
      );
    });

    it('rejects an owner reference that differs from the account (CHECK)', async () => {
      await expect(
        prisma.$executeRaw`
          INSERT INTO customer_account_members (customer_number, account_customer_number, account_owner_ref)
          VALUES ('Y', 'A', 'B')`,
      ).rejects.toThrow(/customer_account_members_account_owner_ref_check/);
    });

    it('rejects removing an owner that still has members (foreign key)', async () => {
      await expect(
        prisma.customerAccountMember.delete({ where: { customerNumber: 'A' } }),
      ).rejects.toThrow();
    });
  });

  describe('B2B units and partner assignments', () => {
    it('accepts partners that belong to the unit account', async () => {
      await createUnit();
      await addShipTo('A', true);
      await expect(addShipTo('X', false)).resolves.toBeDefined();
    });

    it.each([
      ['Sold-to', { soldToCustomerNumber: 'B' }],
      ['Bill-to', { billToCustomerNumber: 'B' }],
      ['Payer', { payerCustomerNumber: 'Y' }],
    ])(
      'rejects a %s outside the account (foreign key)',
      async (_role, overrides) => {
        await expect(createUnit(overrides)).rejects.toThrow(
          /Foreign key constraint/,
        );
      },
    );

    it('rejects a unit whose account is only a member (foreign key)', async () => {
      await expect(
        createUnit({
          accountCustomerNumber: 'X',
          soldToCustomerNumber: 'X',
          billToCustomerNumber: 'X',
          payerCustomerNumber: 'X',
        }),
      ).rejects.toThrow(/Foreign key constraint/);
    });

    it('rejects a ship-to from another account (foreign key)', async () => {
      await createUnit();
      await expect(addShipTo('B', false)).rejects.toThrow(
        /Foreign key constraint/,
      );
    });

    it('rejects a ship-to row whose account differs from the unit account (foreign key)', async () => {
      await createUnit();
      await expect(addShipTo('B', false, 'B')).rejects.toThrow(
        /Foreign key constraint/,
      );
    });

    it('rejects a second default ship-to (partial unique index)', async () => {
      await createUnit();
      await addShipTo('A', true);
      await expect(addShipTo('X', true)).rejects.toThrow(/Unique constraint/);
    });

    it('allows many non-default ship-tos', async () => {
      await createUnit();
      await addShipTo('A', false);
      await expect(addShipTo('X', false)).resolves.toBeDefined();
    });

    it('rejects removing a membership that is used by a unit (foreign key)', async () => {
      await createUnit();
      await expect(
        prisma.customerAccountMember.delete({ where: { customerNumber: 'X' } }),
      ).rejects.toThrow(/Foreign key constraint/);
    });

    it('rejects changing a customer number that is referenced (ON UPDATE RESTRICT)', async () => {
      await expect(
        prisma.$executeRaw`UPDATE customers SET customer_number = 'X2' WHERE customer_number = 'X'`,
      ).rejects.toThrow();
    });
  });

  describe('transactions', () => {
    it('rolls back all changes when a later step fails', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.b2bUnit.create({
            data: {
              unitId: 'U-ROLLBACK',
              name: 'Rollback',
              accountCustomerNumber: 'A',
              soldToCustomerNumber: 'A',
              billToCustomerNumber: 'A',
              payerCustomerNumber: 'A',
            },
          });
          // fails: B does not belong to account A
          await tx.b2bUnitShipTo.create({
            data: {
              unitId: 'U-ROLLBACK',
              customerNumber: 'B',
              accountCustomerNumber: 'A',
              isDefault: true,
            },
          });
        }),
      ).rejects.toThrow();

      await expect(
        prisma.b2bUnit.findUnique({ where: { unitId: 'U-ROLLBACK' } }),
      ).resolves.toBeNull();
    });
  });

  describe('migrations', () => {
    it('match the Prisma schema exactly (no drift, CHECK constraint kept)', () => {
      const diff = spawnSync(
        process.execPath,
        [
          'node_modules/prisma/build/index.js',
          'migrate',
          'diff',
          '--from-config-datasource',
          '--to-schema',
          'prisma/schema.prisma',
          '--exit-code',
        ],
        { env: process.env, encoding: 'utf8' },
      );

      // --exit-code: 0 = no difference, 2 = difference, 1 = error
      expect({ status: diff.status, stderr: diff.stderr }).toEqual({
        status: 0,
        stderr: expect.any(String),
      });
    });
  });
});
