import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ShopUsersService } from '../../src/shop/users/shop-users.service';
import { ShopUserRuleCode } from '../../src/shop/users/shop-user-rules';
import {
  createCustomers,
  createJapanData,
  createMuellerData,
  createPolandData,
  createTestApp,
  GERMANY,
  resetDatabase,
  tableFingerprint,
} from './helpers';

// Shop users and their B2B unit authorizations (Sprint 12A).
//
// Test data shaped like the development data: account CUST-1000 (Müller
// Heiztechnik) with the members CUST-1100 and CUST-1200 and the units
// UNIT-STUTTGART and UNIT-MUENCHEN; account JP-1000 with UNIT-OSAKA;
// account PL-1000 with UNIT-WARSZAWA; CUST-2000 belongs to no account.

/** The PostgreSQL error code of a failed statement, or 'ok' */
async function codeOf(statement: Promise<unknown>) {
  const error = await statement.then(
    () => null,
    (e: unknown) => e,
  );
  if (error === null) return 'ok';
  const meta = (error as { meta?: Record<string, unknown> }).meta;
  const adapterError = meta?.driverAdapterError as
    { cause?: { originalCode?: string } } | undefined;
  return adapterError?.cause?.originalCode ?? (error as Error).message;
}

const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
/** A referenced row is deleted or its key changed (ON DELETE/UPDATE RESTRICT) */
const RESTRICT_VIOLATION = '23001';

/** Every table except the shop user tables */
const ERP_TABLES = (fingerprint: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(fingerprint).filter(([table]) => !table.startsWith('shop_')),
  );

describe('Shop users and unit authorization (Sprint 12A)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];
  let users: ShopUsersService;

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
    users = app.get(ShopUsersService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMuellerData(prisma);
    await createJapanData(prisma);
    await createPolandData(prisma);
  });

  const createAnna = () =>
    users.createUser({
      accountCustomerNumber: 'CUST-1000',
      email: '  Anna.Weber@Mueller-Heiztechnik.EXAMPLE ',
      displayName: ' Anna Weber ',
    });
  const createUser = (accountCustomerNumber: string, email: string) =>
    users.createUser({ accountCustomerNumber, email, displayName: email });

  async function expectRule(promise: Promise<unknown>, code: ShopUserRuleCode) {
    await expect(promise).rejects.toMatchObject({
      name: 'ShopUserRuleError',
      code,
    });
  }

  const setCustomerActive = (customerNumber: string, isActive: boolean) =>
    prisma.customer.update({ where: { customerNumber }, data: { isActive } });
  const setUnitActive = (unitId: string, isActive: boolean) =>
    prisma.b2bUnit.update({ where: { unitId }, data: { isActive } });

  describe('creating users', () => {
    it('creates an active BUYER with normalized e-mail address and name', async () => {
      const anna = await createAnna();
      expect(anna).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        accountCustomerNumber: 'CUST-1000',
        email: 'anna.weber@mueller-heiztechnik.example',
        displayName: 'Anna Weber',
        status: 'ACTIVE',
        role: 'BUYER',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(await users.findUser(anna.id)).toEqual(anna);
      expect(
        await users.findUserByEmail('ANNA.WEBER@mueller-heiztechnik.example '),
      ).toEqual(anna);
    });

    it('keeps e-mail addresses unique in every spelling, also across accounts', async () => {
      await createAnna();
      for (const [account, email] of [
        ['CUST-1000', 'anna.weber@mueller-heiztechnik.example'],
        ['CUST-1000', 'ANNA.WEBER@MUELLER-HEIZTECHNIK.EXAMPLE'],
        ['JP-1000', ' Anna.Weber@mueller-heiztechnik.example'],
      ]) {
        await expectRule(createUser(account, email), 'EMAIL_TAKEN');
      }
      expect(await prisma.shopUser.count()).toBe(1);
    });

    it('rejects an invalid e-mail address or name and stores nothing', async () => {
      await expectRule(createUser('CUST-1000', 'anna.weber'), 'EMAIL_INVALID');
      await expectRule(
        users.createUser({
          accountCustomerNumber: 'CUST-1000',
          email: 'a@b.de',
          displayName: '  ',
        }),
        'DISPLAY_NAME_INVALID',
      );
      expect(await prisma.shopUser.count()).toBe(0);
    });

    it('allows several users per account', async () => {
      const a = await createUser('CUST-1000', 'a@mueller.example');
      const b = await createUser('CUST-1000', 'b@mueller.example');
      const c = await createUser('JP-1000', 'c@osaka.example');
      expect(new Set([a.id, b.id, c.id]).size).toBe(3);
      expect(
        await prisma.shopUser.count({
          where: { accountCustomerNumber: 'CUST-1000' },
        }),
      ).toBe(2);
    });

    it('only creates users of an account, never of a member or a lone customer', async () => {
      // CUST-1100 is a member (warehouse) of account CUST-1000, CUST-2000
      // belongs to no account
      for (const account of ['CUST-1100', 'CUST-2000', 'CUST-9999']) {
        await expectRule(
          createUser(account, `x@${account}.example`),
          'ACCOUNT_NOT_FOUND',
        );
      }
    });

    it('creates no users for an inactive account', async () => {
      await setCustomerActive('CUST-1000', false);
      await expectRule(createAnna(), 'ACCOUNT_INACTIVE');
    });
  });

  describe('assigning units', () => {
    it('assigns several units to a user and a unit to several users', async () => {
      const anna = await createAnna();
      const ben = await createUser('CUST-1000', 'ben@mueller.example');
      expect(await users.assignUnit(anna.id, 'UNIT-STUTTGART')).toEqual({
        created: true,
      });
      await users.assignUnit(anna.id, 'UNIT-MUENCHEN');
      await users.assignUnit(ben.id, 'UNIT-MUENCHEN');

      expect(
        (await users.authorizedUnits(anna.id)).map((u) => u.unitId),
      ).toEqual(['UNIT-MUENCHEN', 'UNIT-STUTTGART']);
      expect(await users.authorizedUnits(ben.id)).toEqual([
        {
          unitId: 'UNIT-MUENCHEN',
          name: 'Müller UNIT-MUENCHEN',
          salesArea: GERMANY,
          canOrder: true,
        },
      ]);
    });

    it('treats a repeated assignment as done', async () => {
      const anna = await createAnna();
      await users.assignUnit(anna.id, 'UNIT-STUTTGART');
      expect(await users.assignUnit(anna.id, 'UNIT-STUTTGART')).toEqual({
        created: false,
      });
      expect(await prisma.shopUserUnit.count()).toBe(1);
    });

    it('never assigns a unit of another account', async () => {
      const anna = await createAnna();
      for (const unitId of ['UNIT-OSAKA', 'UNIT-WARSZAWA']) {
        await expectRule(
          users.assignUnit(anna.id, unitId),
          'UNIT_OF_OTHER_ACCOUNT',
        );
      }
      expect(await prisma.shopUserUnit.count()).toBe(0);
    });

    it('names unknown users and units', async () => {
      const anna = await createAnna();
      await expectRule(
        users.assignUnit(anna.id, 'UNIT-NONE'),
        'UNIT_NOT_FOUND',
      );
      for (const userId of [randomUUID(), 'not-a-uuid']) {
        await expectRule(
          users.assignUnit(userId, 'UNIT-STUTTGART'),
          'USER_NOT_FOUND',
        );
      }
    });

    it('assigns no inactive unit', async () => {
      const anna = await createAnna();
      await setUnitActive('UNIT-MUENCHEN', false);
      await expectRule(
        users.assignUnit(anna.id, 'UNIT-MUENCHEN'),
        'UNIT_INACTIVE',
      );
    });
  });

  describe('authorization', () => {
    it('authorizes an active user for the assigned units only', async () => {
      const anna = await createAnna();
      await users.assignUnit(anna.id, 'UNIT-STUTTGART');
      for (const purpose of ['VIEW', 'ORDER'] as const) {
        expect(
          await users.isAuthorizedForUnit(anna.id, 'UNIT-STUTTGART', purpose),
        ).toBe(true);
        // Own account, but not assigned
        expect(
          await users.isAuthorizedForUnit(anna.id, 'UNIT-MUENCHEN', purpose),
        ).toBe(false);
        // Other accounts
        expect(
          await users.isAuthorizedForUnit(anna.id, 'UNIT-OSAKA', purpose),
        ).toBe(false);
      }
    });

    it('never authorizes another account’s user for a unit', async () => {
      const anna = await createAnna();
      const kenji = await createUser('JP-1000', 'kenji@osaka.example');
      await users.assignUnit(anna.id, 'UNIT-STUTTGART');
      await users.assignUnit(kenji.id, 'UNIT-OSAKA');
      expect(
        await users.isAuthorizedForUnit(kenji.id, 'UNIT-STUTTGART', 'VIEW'),
      ).toBe(false);
      expect(
        (await users.authorizedUnits(kenji.id)).map((u) => u.unitId),
      ).toEqual(['UNIT-OSAKA']);
    });

    it('authorizes nothing for unknown or malformed user IDs and units', async () => {
      const anna = await createAnna();
      await users.assignUnit(anna.id, 'UNIT-STUTTGART');
      for (const userId of [randomUUID(), 'x', "' OR 1=1 --"]) {
        expect(await users.authorizedUnits(userId)).toEqual([]);
        expect(
          await users.isAuthorizedForUnit(userId, 'UNIT-STUTTGART', 'VIEW'),
        ).toBe(false);
      }
      expect(
        await users.isAuthorizedForUnit(anna.id, 'UNIT-NONE', 'VIEW'),
      ).toBe(false);
    });

    it('authorizes a disabled user for nothing, and again once enabled', async () => {
      const anna = await createAnna();
      await users.assignUnit(anna.id, 'UNIT-STUTTGART');
      expect((await users.setStatus(anna.id, 'DISABLED')).status).toBe(
        'DISABLED',
      );
      expect(await users.authorizedUnits(anna.id)).toEqual([]);
      expect(
        await users.isAuthorizedForUnit(anna.id, 'UNIT-STUTTGART', 'VIEW'),
      ).toBe(false);
      // The assignments are kept and can even be extended
      await users.assignUnit(anna.id, 'UNIT-MUENCHEN');
      expect(await prisma.shopUserUnit.count()).toBe(2);

      await users.setStatus(anna.id, 'ACTIVE');
      expect(
        (await users.authorizedUnits(anna.id)).map((u) => u.unitId),
      ).toEqual(['UNIT-MUENCHEN', 'UNIT-STUTTGART']);
      await expectRule(
        users.setStatus(randomUUID(), 'ACTIVE'),
        'USER_NOT_FOUND',
      );
    });

    it('keeps a deactivated unit viewable, but not orderable', async () => {
      const anna = await createAnna();
      await users.assignUnit(anna.id, 'UNIT-STUTTGART');
      await setUnitActive('UNIT-STUTTGART', false);
      expect(
        await users.isAuthorizedForUnit(anna.id, 'UNIT-STUTTGART', 'VIEW'),
      ).toBe(true);
      expect(
        await users.isAuthorizedForUnit(anna.id, 'UNIT-STUTTGART', 'ORDER'),
      ).toBe(false);
      expect(await users.authorizedUnits(anna.id)).toEqual([
        expect.objectContaining({ unitId: 'UNIT-STUTTGART', canOrder: false }),
      ]);
    });

    it('authorizes nobody of an inactive account, until it is active again', async () => {
      const anna = await createAnna();
      await users.assignUnit(anna.id, 'UNIT-STUTTGART');
      await setCustomerActive('CUST-1000', false);
      expect(await users.authorizedUnits(anna.id)).toEqual([]);
      expect(
        await users.isAuthorizedForUnit(anna.id, 'UNIT-STUTTGART', 'VIEW'),
      ).toBe(false);
      // The user and the assignment remain
      expect(await users.findUser(anna.id)).toMatchObject({ status: 'ACTIVE' });
      await setCustomerActive('CUST-1000', true);
      expect(
        await users.isAuthorizedForUnit(anna.id, 'UNIT-STUTTGART', 'ORDER'),
      ).toBe(true);
    });
  });

  describe('removing assignments', () => {
    it('removes only the authorization, never the unit or its ERP data', async () => {
      const anna = await createAnna();
      const ben = await createUser('CUST-1000', 'ben@mueller.example');
      await users.assignUnit(anna.id, 'UNIT-STUTTGART');
      await users.assignUnit(ben.id, 'UNIT-STUTTGART');
      const before = ERP_TABLES(await tableFingerprint(prisma));

      expect(await users.unassignUnit(anna.id, 'UNIT-STUTTGART')).toBe(true);
      expect(await users.unassignUnit(anna.id, 'UNIT-STUTTGART')).toBe(false);
      expect(await users.unassignUnit('not-a-uuid', 'UNIT-STUTTGART')).toBe(
        false,
      );

      expect(
        await users.isAuthorizedForUnit(anna.id, 'UNIT-STUTTGART', 'VIEW'),
      ).toBe(false);
      // The other user keeps the unit; units, Ship-tos, partners, prices and
      // orders are unchanged
      expect(
        await users.isAuthorizedForUnit(ben.id, 'UNIT-STUTTGART', 'ORDER'),
      ).toBe(true);
      expect(ERP_TABLES(await tableFingerprint(prisma))).toEqual(before);
    });
  });

  describe('database constraints (independent of the service)', () => {
    const insertUser = (
      account: string,
      ownerRef: string,
      email: string,
      name = 'Test User',
    ) =>
      prisma.$executeRaw`
        INSERT INTO shop_users (account_customer_number, account_owner_ref, email, display_name, updated_at)
        VALUES (${account}, ${ownerRef}, ${email}, ${name}, now())`;
    const insertAssignment = (
      userId: string,
      unitId: string,
      account: string,
    ) =>
      prisma.$executeRaw`
        INSERT INTO shop_user_units (user_id, unit_id, account_customer_number)
        VALUES (${userId}::uuid, ${unitId}, ${account})`;

    it('only accepts users of an account owner row', async () => {
      expect(await codeOf(insertUser('CUST-1000', 'CUST-1000', 'a@b.de'))).toBe(
        'ok',
      );
      // A member is no account; the owner reference must repeat the account
      expect(await codeOf(insertUser('CUST-1100', 'CUST-1100', 'c@d.de'))).toBe(
        FOREIGN_KEY_VIOLATION,
      );
      expect(await codeOf(insertUser('CUST-1000', 'CUST-1100', 'e@f.de'))).toBe(
        CHECK_VIOLATION,
      );
      expect(await codeOf(insertUser('NOBODY', 'NOBODY', 'g@h.de'))).toBe(
        FOREIGN_KEY_VIOLATION,
      );
    });

    it('stores e-mail addresses normalized and unique', async () => {
      await insertUser('CUST-1000', 'CUST-1000', 'anna@mueller.example');
      for (const [email, code] of [
        ['anna@mueller.example', UNIQUE_VIOLATION],
        ['Anna@Mueller.example', CHECK_VIOLATION],
        [' anna@mueller.example', CHECK_VIOLATION],
        ['anna', CHECK_VIOLATION],
        ['a@b@c.de', CHECK_VIOLATION],
      ] as const) {
        expect(await codeOf(insertUser('CUST-1000', 'CUST-1000', email))).toBe(
          code,
        );
      }
    });

    it('rejects blank or padded display names', async () => {
      for (const name of ['', '  ', ' Anna', 'Anna\nWeber']) {
        expect(
          await codeOf(insertUser('CUST-1000', 'CUST-1000', 'x@y.de', name)),
        ).toBe(CHECK_VIOLATION);
      }
    });

    it('rejects any unit assignment across accounts', async () => {
      const anna = await createAnna();
      // Correct account of the user, unit of another account
      expect(
        await codeOf(insertAssignment(anna.id, 'UNIT-OSAKA', 'CUST-1000')),
      ).toBe(FOREIGN_KEY_VIOLATION);
      // Correct account of the unit, user of another account
      expect(
        await codeOf(insertAssignment(anna.id, 'UNIT-OSAKA', 'JP-1000')),
      ).toBe(FOREIGN_KEY_VIOLATION);
      expect(
        await codeOf(insertAssignment(anna.id, 'UNIT-STUTTGART', 'CUST-1000')),
      ).toBe('ok');
      expect(
        await codeOf(insertAssignment(anna.id, 'UNIT-STUTTGART', 'CUST-1000')),
      ).toBe(UNIQUE_VIOLATION);
      expect(await prisma.shopUserUnit.count()).toBe(1);
    });

    it('keeps references intact: no unit, user or account disappears or moves under an assignment', async () => {
      const anna = await createAnna();
      await users.assignUnit(anna.id, 'UNIT-STUTTGART');
      expect(
        await codeOf(
          prisma.$executeRaw`DELETE FROM b2b_units WHERE unit_id = 'UNIT-STUTTGART'`,
        ),
      ).toBe(RESTRICT_VIOLATION);
      expect(
        await codeOf(
          prisma.$executeRaw`DELETE FROM shop_users WHERE id = ${anna.id}::uuid`,
        ),
      ).toBe(RESTRICT_VIOLATION);
      expect(
        await codeOf(prisma.$executeRaw`
          UPDATE shop_users SET account_customer_number = 'JP-1000', account_owner_ref = 'JP-1000'
          WHERE id = ${anna.id}::uuid`),
      ).toBe(RESTRICT_VIOLATION);
      expect(
        await codeOf(prisma.$executeRaw`
          DELETE FROM customer_account_members WHERE customer_number = 'CUST-1000'`),
      ).toBe(RESTRICT_VIOLATION);
      expect(
        await users.isAuthorizedForUnit(anna.id, 'UNIT-STUTTGART', 'ORDER'),
      ).toBe(true);
    });

    it('can only remove a user without assignments (users are disabled, not deleted)', async () => {
      const anna = await createAnna();
      expect(
        await codeOf(
          prisma.$executeRaw`DELETE FROM shop_users WHERE id = ${anna.id}::uuid`,
        ),
      ).toBe('ok');
    });
  });

  describe('existing ERP behavior', () => {
    it('still maintains account members while the account has shop users', async () => {
      const anna = await createAnna();
      await users.assignUnit(anna.id, 'UNIT-STUTTGART');
      await createCustomers(prisma, ['CUST-1300']);
      await http()
        .put('/customer-accounts/CUST-1000/members')
        .send({
          memberCustomerNumbers: ['CUST-1100', 'CUST-1200', 'CUST-1300'],
        })
        .expect(200);
      await http()
        .put('/customer-accounts/CUST-1000/members')
        .send({ memberCustomerNumbers: ['CUST-1100', 'CUST-1200'] })
        .expect(200);
      expect(
        await users.isAuthorizedForUnit(anna.id, 'UNIT-STUTTGART', 'ORDER'),
      ).toBe(true);
    });

    it('still deactivates and reactivates an assigned unit through the API', async () => {
      const anna = await createAnna();
      await users.assignUnit(anna.id, 'UNIT-MUENCHEN');
      await http()
        .patch('/b2b-units/UNIT-MUENCHEN')
        .send({ isActive: false })
        .expect(200);
      expect(
        await users.isAuthorizedForUnit(anna.id, 'UNIT-MUENCHEN', 'ORDER'),
      ).toBe(false);
      await http()
        .patch('/b2b-units/UNIT-MUENCHEN')
        .send({ isActive: true })
        .expect(200);
      expect(
        await users.isAuthorizedForUnit(anna.id, 'UNIT-MUENCHEN', 'ORDER'),
      ).toBe(true);
    });

    it('leaves sales orders, prices and master data untouched', async () => {
      const order = await http()
        .post('/sales-orders')
        .send({
          requestId: randomUUID(),
          ...GERMANY,
          unitId: 'UNIT-STUTTGART',
          items: [
            {
              materialNumber: 'MAT-001',
              quantity: 1,
              expectedUnitPrice: '4500.00',
            },
          ],
          expectedTotal: { netValue: '4500.00', currency: 'EUR' },
        })
        .expect(201);
      const before = ERP_TABLES(await tableFingerprint(prisma));

      const anna = await createAnna();
      await users.assignUnit(anna.id, 'UNIT-STUTTGART');
      await users.assignUnit(anna.id, 'UNIT-MUENCHEN');
      await users.unassignUnit(anna.id, 'UNIT-MUENCHEN');
      await users.setStatus(anna.id, 'DISABLED');

      expect(ERP_TABLES(await tableFingerprint(prisma))).toEqual(before);
      // The historical order is read as before
      const read = await http()
        .get(
          `/sales-orders/${(order.body as { salesOrderNumber: string }).salesOrderNumber}`,
        )
        .expect(200);
      expect(read.body).toMatchObject({ unit: { unitId: 'UNIT-STUTTGART' } });
      expect(
        (await http().get('/sales-orders').expect(200)).body,
      ).toMatchObject({ total: 1 });
    });

    // Since Sprint 12C the local admin API manages users (/shop-users,
    // shop-users-admin-api.int-spec.ts); the customer API never does
    it('offers no shop user management in the customer API', async () => {
      for (const path of [
        '/shop/v1/users',
        '/shop/v1/shop-users',
        '/shop/v1/users/x/units',
      ]) {
        await http().get(path).expect(404);
      }
    });
  });
});
