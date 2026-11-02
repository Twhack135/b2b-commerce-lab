import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { tokenHash } from '../../src/shop/auth/tokens';
import { SHOP_SERVICE_KEY_HEADER } from '../../src/shop/shop-service-key';
import {
  createJapanData,
  createMuellerData,
  createTestApp,
  resetDatabase,
  TestClock,
} from './helpers';

// Sprint 12C: the local shop user administration (admin API /shop-users)
// and the account context of the shop (/shop/v1/account) with the
// server-checked unit selection. Tokens and passwords only exist in memory
// here; they are never printed.

const KEY = randomBytes(32).toString('hex');
const SHOP_URL = 'http://127.0.0.1:3303';
const START = '2026-11-20T09:00:00.000Z';
const PASSWORD = 'warm winter heat pump 2026';
const MINUTE = 60_000;

type Detail = {
  id: string;
  email: string;
  status: string;
  access: string;
  activation: string;
  unitCount: number;
  activeSessionCount: number;
  units: { unitId: string; access: string; isActive: boolean }[];
  sessions: {
    id: string;
    createdAt: string;
    lastSeenAt: string;
    endsAt: string;
  }[];
  activationDetails: {
    activatedAt: string | null;
    openLink: { createdAt: string; expiresAt: string } | null;
  };
};

describe('Shop user administration /shop-users and account context (Sprint 12C)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];
  const clock = new TestClock(new Date(START));
  const saved: Record<string, string | undefined> = {};
  /** A fresh client address and day per test keeps the sign-in limits apart */
  let round = 0;

  beforeAll(async () => {
    for (const name of ['SHOP_SERVICE_KEY', 'SHOP_PUBLIC_URL']) {
      saved[name] = process.env[name];
    }
    process.env.SHOP_SERVICE_KEY = KEY;
    process.env.SHOP_PUBLIC_URL = SHOP_URL;
    ({ app, prisma, http } = await createTestApp({ clock }));
  });

  afterAll(async () => {
    await app.close();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  beforeEach(async () => {
    round += 1;
    clock.set(
      new Date(Date.parse(START) + round * 24 * 60 * MINUTE).toISOString(),
    );
    await resetDatabase(prisma);
    await createMuellerData(prisma);
    await createJapanData(prisma);
  });

  const admin = () => http();
  const create = (body: object) => admin().post('/shop-users').send(body);
  const detail = async (id: string) =>
    (await admin().get(`/shop-users/${id}`).expect(200)).body as Detail;
  const advance = (ms: number) =>
    clock.set(new Date(clock.now().getTime() + ms).toISOString());

  async function anna(units = ['UNIT-STUTTGART', 'UNIT-MUENCHEN']) {
    const response = await create({
      accountCustomerNumber: 'CUST-1000',
      email: ' Anna.Weber@Mueller.example ',
      displayName: ' Anna Weber ',
      unitIds: units,
    }).expect(201);
    return response.body as Detail;
  }

  const shop = (method: 'get' | 'post', path: string) =>
    http()
      [method](`/shop/v1${path}`)
      .set(SHOP_SERVICE_KEY_HEADER, KEY)
      .set('x-shop-client-address', `10.1.0.${round % 250}`);

  /** The link's token, as the shop page would read it from the fragment */
  async function activationToken(userId: string) {
    const response = await admin()
      .post(`/shop-users/${userId}/activation-link`)
      .expect(201);
    return new URL(response.body.activationLink as string).hash.slice(
      '#token='.length,
    );
  }

  /** Activates the user through the shop API and signs in */
  async function signIn(user: Detail) {
    const token = await activationToken(user.id);
    await shop('post', '/auth/activation')
      .send({ token, password: PASSWORD })
      .expect(204);
    const response = await shop('post', '/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    return response.body.sessionToken as string;
  }

  const context = (session: string, unit?: string) => {
    const request = shop('get', '/account').set('x-shop-session', session);
    return unit === undefined ? request : request.set('x-shop-unit', unit);
  };

  describe('creating and listing shop users', () => {
    it('creates a buyer with units of the account; never returns secrets', async () => {
      const response = await create({
        accountCustomerNumber: 'CUST-1000',
        email: ' Anna.Weber@Mueller.example ',
        displayName: ' Anna Weber ',
        unitIds: ['UNIT-STUTTGART', 'UNIT-MUENCHEN'],
      }).expect(201);
      expect(response.headers['cache-control']).toBe('no-store');
      const user = response.body as Detail;
      expect(user).toMatchObject({
        email: 'anna.weber@mueller.example',
        displayName: 'Anna Weber',
        status: 'ACTIVE',
        role: 'BUYER',
        account: { customerNumber: 'CUST-1000', isActive: true },
        access: 'GRANTED',
        activation: 'NOT_INVITED',
        unitCount: 2,
        activeSessionCount: 0,
        sessions: [],
        activationDetails: { activatedAt: null, openLink: null },
      });
      expect(user.units.map((u) => [u.unitId, u.access])).toEqual([
        ['UNIT-MUENCHEN', 'ORDER'],
        ['UNIT-STUTTGART', 'ORDER'],
      ]);

      const list = await admin().get('/shop-users').expect(200);
      expect(list.headers['cache-control']).toBe('no-store');
      expect(list.body).toEqual([
        {
          id: user.id,
          email: 'anna.weber@mueller.example',
          displayName: 'Anna Weber',
          status: 'ACTIVE',
          role: 'BUYER',
          account: {
            customerNumber: 'CUST-1000',
            name: expect.any(String),
            isActive: true,
          },
          access: 'GRANTED',
          activation: 'NOT_INVITED',
          unitCount: 2,
          activeSessionCount: 0,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      ]);
    });

    it('refuses invalid data, other accounts and inactive units; nothing is stored', async () => {
      await anna();
      const valid = {
        accountCustomerNumber: 'CUST-1000',
        email: 'ben@mueller.example',
        displayName: 'Ben',
      };
      const cases: [object, number, string][] = [
        [
          { ...valid, email: 'ANNA.WEBER@mueller.example' },
          409,
          'already exists',
        ],
        [
          { ...valid, email: 'not an address' },
          422,
          'e-mail address is not valid',
        ],
        [{ ...valid, displayName: '   ' }, 422, 'display name'],
        [{ ...valid, accountCustomerNumber: 'NOPE' }, 422, 'does not exist'],
        // A member customer is no account of its own
        [
          { ...valid, accountCustomerNumber: 'CUST-1100' },
          422,
          'does not exist',
        ],
        [
          { ...valid, unitIds: ['UNIT-OSAKA'] },
          422,
          'UNIT-OSAKA: The B2B unit belongs to another customer account',
        ],
        [
          { ...valid, unitIds: ['UNIT-STUTTGART', 'UNIT-NOPE'] },
          422,
          'UNIT-NOPE: The B2B unit does not exist',
        ],
        [
          { ...valid, passwordHash: '$argon2id$v=19$x' },
          400,
          'should not exist',
        ],
        [
          { ...valid, unitIds: ['UNIT-STUTTGART', 'UNIT-STUTTGART'] },
          400,
          'unique',
        ],
      ];
      for (const [body, status, message] of cases) {
        const response = await create(body).expect(status);
        expect(JSON.stringify(response.body.message)).toContain(message);
      }
      await prisma.b2bUnit.update({
        where: { unitId: 'UNIT-MUENCHEN' },
        data: { isActive: false },
      });
      const inactive = await create({
        ...valid,
        unitIds: ['UNIT-MUENCHEN'],
      }).expect(422);
      expect(inactive.body.message).toBe(
        'UNIT-MUENCHEN: The B2B unit is inactive and cannot be assigned.',
      );
      await prisma.customer.update({
        where: { customerNumber: 'JP-1000' },
        data: { isActive: false },
      });
      await create({
        accountCustomerNumber: 'JP-1000',
        email: 'kenji@osaka.example',
        displayName: 'Kenji',
      }).expect(422);
      // Only Anna and her two units exist
      expect(await prisma.shopUser.count()).toBe(1);
      expect(await prisma.shopUserUnit.count()).toBe(2);
    });

    it('creates one user when the same address is submitted many times at once', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          create({
            accountCustomerNumber: 'CUST-1000',
            email: 'ben@mueller.example',
            displayName: 'Ben',
            unitIds: ['UNIT-STUTTGART'],
          }),
        ),
      );
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409, 409, 409, 409, 409, 409, 409,
      ]);
      expect(await prisma.shopUser.count()).toBe(1);
      expect(await prisma.shopUserUnit.count()).toBe(1);
    });

    it('answers 404 for unknown or malformed user IDs', async () => {
      for (const id of [
        '00000000-0000-4000-8000-000000000000',
        'not-a-uuid',
        "1' OR '1'='1",
      ]) {
        await admin()
          .get(`/shop-users/${encodeURIComponent(id)}`)
          .expect(404);
        await admin()
          .patch(`/shop-users/${encodeURIComponent(id)}`)
          .send({ status: 'DISABLED' })
          .expect(404);
        await admin()
          .post(`/shop-users/${encodeURIComponent(id)}/activation-link`)
          .expect(404);
      }
    });
  });

  describe('unit assignments', () => {
    it('assigns units of the own account only and withdraws them again', async () => {
      const user = await anna(['UNIT-STUTTGART']);
      const assigned = await admin()
        .put(`/shop-users/${user.id}/units/UNIT-MUENCHEN`)
        .expect(200);
      expect((assigned.body as Detail).unitCount).toBe(2);
      // Again: no error, no duplicate
      await admin()
        .put(`/shop-users/${user.id}/units/UNIT-MUENCHEN`)
        .expect(200);
      const foreign = await admin()
        .put(`/shop-users/${user.id}/units/UNIT-OSAKA`)
        .expect(422);
      expect(foreign.body.message).toContain(
        'belongs to another customer account',
      );
      await admin().put(`/shop-users/${user.id}/units/UNIT-NOPE`).expect(404);
      expect(await prisma.shopUserUnit.count()).toBe(2);

      const removed = await admin()
        .delete(`/shop-users/${user.id}/units/UNIT-MUENCHEN`)
        .expect(200);
      expect((removed.body as Detail).units.map((u) => u.unitId)).toEqual([
        'UNIT-STUTTGART',
      ]);
      // Removing it again changes nothing; the unit itself still exists
      await admin()
        .delete(`/shop-users/${user.id}/units/UNIT-MUENCHEN`)
        .expect(200);
      expect(
        await prisma.b2bUnit.count({ where: { unitId: 'UNIT-MUENCHEN' } }),
      ).toBe(1);
    });

    it('stores one assignment when the same unit is assigned many times at once', async () => {
      const user = await anna([]);
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          admin().put(`/shop-users/${user.id}/units/UNIT-STUTTGART`),
        ),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(await prisma.shopUserUnit.count()).toBe(1);
    });

    it('shows an inactive unit as view only and a disabled user with no access', async () => {
      const user = await anna();
      await prisma.b2bUnit.update({
        where: { unitId: 'UNIT-MUENCHEN' },
        data: { isActive: false },
      });
      expect(
        (await detail(user.id)).units.map((u) => [u.unitId, u.access]),
      ).toEqual([
        ['UNIT-MUENCHEN', 'VIEW'],
        ['UNIT-STUTTGART', 'ORDER'],
      ]);
      await admin()
        .patch(`/shop-users/${user.id}`)
        .send({ status: 'DISABLED' })
        .expect(200);
      const disabled = await detail(user.id);
      expect(disabled.access).toBe('USER_DISABLED');
      expect(disabled.units.every((u) => u.access === 'NONE')).toBe(true);
      // Disabled users keep their assignments
      expect(disabled.unitCount).toBe(2);
    });
  });

  describe('activation links', () => {
    it('returns a link with the token in the fragment exactly once; stores only its hash', async () => {
      const user = await anna();
      const response = await admin()
        .post(`/shop-users/${user.id}/activation-link`)
        .expect(201);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(Object.keys(response.body).sort()).toEqual([
        'activationLink',
        'expiresAt',
      ]);
      const link = new URL(response.body.activationLink as string);
      expect(link.origin).toBe(SHOP_URL);
      expect(link.pathname).toBe('/activate');
      expect(link.search).toBe('');
      const token = link.hash.slice('#token='.length);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const stored = await prisma.shopActivationToken.findFirstOrThrow();
      expect(stored.tokenHash).toBe(tokenHash(token));

      // The administration never shows the link again, only its state
      const after = await detail(user.id);
      expect(after.activation).toBe('LINK_OPEN');
      expect(after.activationDetails.openLink?.expiresAt).toBe(
        response.body.expiresAt,
      );
      const everything = JSON.stringify([
        after,
        (await admin().get('/shop-users').expect(200)).body,
      ]);
      expect(everything).not.toContain(token);
      expect(everything).not.toContain(stored.tokenHash);
      expect(everything.toLowerCase()).not.toContain('hash');
    });

    it('replaces an unused link; the old one stops working', async () => {
      const user = await anna();
      const first = await activationToken(user.id);
      const second = await activationToken(user.id);
      await shop('post', '/auth/activation')
        .send({ token: first, password: PASSWORD })
        .expect(400);
      await shop('post', '/auth/activation')
        .send({ token: second, password: PASSWORD })
        .expect(204);
      await shop('post', '/auth/activation')
        .send({ token: second, password: PASSWORD })
        .expect(400);
      const activated = await detail(user.id);
      expect(activated.activation).toBe('ACTIVATED');
      expect(activated.activationDetails.openLink).toBeNull();
      expect(activated.activationDetails.activatedAt).not.toBeNull();
    });

    it('reports an expired link, and refuses links that could not be used', async () => {
      const user = await anna();
      await activationToken(user.id);
      advance(24 * 60 * MINUTE);
      expect((await detail(user.id)).activation).toBe('LINK_EXPIRED');

      await admin()
        .patch(`/shop-users/${user.id}`)
        .send({ status: 'DISABLED' })
        .expect(200);
      const disabled = await admin()
        .post(`/shop-users/${user.id}/activation-link`)
        .expect(409);
      expect(disabled.body.message).toBe(
        'The shop user is disabled. Enable the user first.',
      );
      await admin()
        .patch(`/shop-users/${user.id}`)
        .send({ status: 'ACTIVE' })
        .expect(200);

      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: false },
      });
      const inactive = await admin()
        .post(`/shop-users/${user.id}/activation-link`)
        .expect(409);
      expect(inactive.body.message).toBe(
        'The customer account of the shop user is inactive.',
      );
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: true },
      });

      await signIn(user);
      const again = await admin()
        .post(`/shop-users/${user.id}/activation-link`)
        .expect(409);
      expect(again.body.message).toContain('already set a password');
    });

    it('refuses to issue links without a valid shop address', async () => {
      const user = await anna();
      process.env.SHOP_PUBLIC_URL = 'http://shop.example.com';
      try {
        await admin()
          .post(`/shop-users/${user.id}/activation-link`)
          .expect(503);
      } finally {
        process.env.SHOP_PUBLIC_URL = SHOP_URL;
      }
      expect(await prisma.shopActivationToken.count()).toBe(0);
    });
  });

  describe('sessions and status', () => {
    it('lists open sessions without tokens and revokes one or all', async () => {
      const user = await anna();
      const first = await signIn(user);
      const second = (
        await shop('post', '/auth/login')
          .send({ email: user.email, password: PASSWORD })
          .expect(200)
      ).body.sessionToken as string;
      const open = await detail(user.id);
      expect(open.activeSessionCount).toBe(2);
      expect(Object.keys(open.sessions[0]).sort()).toEqual([
        'createdAt',
        'endsAt',
        'id',
        'lastSeenAt',
      ]);
      const text = JSON.stringify(open);
      for (const secret of [
        first,
        second,
        tokenHash(first),
        tokenHash(second),
      ]) {
        expect(text).not.toContain(secret);
      }

      const firstId = (
        await prisma.shopSession.findFirstOrThrow({
          where: { tokenHash: tokenHash(first) },
        })
      ).id;
      const revoked = await admin()
        .post(`/shop-users/${user.id}/sessions/${firstId}/revoke`)
        .expect(200);
      expect((revoked.body as Detail).sessions.map((s) => s.id)).not.toContain(
        firstId,
      );
      await context(first).expect(401);
      await context(second).expect(200);

      // A session of another user, or an unknown one, is not found
      const ben = (
        await create({
          accountCustomerNumber: 'CUST-1000',
          email: 'ben@mueller.example',
          displayName: 'Ben',
        }).expect(201)
      ).body as Detail;
      const secondId = (
        await prisma.shopSession.findFirstOrThrow({
          where: { tokenHash: tokenHash(second) },
        })
      ).id;
      await admin()
        .post(`/shop-users/${ben.id}/sessions/${secondId}/revoke`)
        .expect(404);
      await admin()
        .post(`/shop-users/${user.id}/sessions/not-a-uuid/revoke`)
        .expect(404);
      await context(second).expect(200);

      const all = await admin()
        .post(`/shop-users/${user.id}/sessions/revoke-all`)
        .expect(200);
      expect((all.body as Detail).activeSessionCount).toBe(0);
      await context(second).expect(401);
      // Signing in again stays possible: revoking is no lock-out
      await shop('post', '/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
    });

    it('does not list sessions that ended by time', async () => {
      const user = await anna();
      await signIn(user);
      expect((await detail(user.id)).activeSessionCount).toBe(1);
      advance(30 * MINUTE);
      expect((await detail(user.id)).activeSessionCount).toBe(0);
    });

    it('disabling ends every session; enabling restores none', async () => {
      const user = await anna();
      const session = await signIn(user);
      await admin()
        .patch(`/shop-users/${user.id}`)
        .send({ status: 'DISABLED' })
        .expect(200);
      await context(session).expect(401);
      await shop('post', '/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(401);

      const enabled = await admin()
        .patch(`/shop-users/${user.id}`)
        .send({ status: 'ACTIVE' })
        .expect(200);
      expect((enabled.body as Detail).access).toBe('GRANTED');
      await context(session).expect(401);
      const fresh = (
        await shop('post', '/auth/login')
          .send({ email: user.email, password: PASSWORD })
          .expect(200)
      ).body.sessionToken as string;
      await context(fresh).expect(200);
    });

    it('changes the display name; e-mail address and account stay fixed', async () => {
      const user = await anna();
      const renamed = await admin()
        .patch(`/shop-users/${user.id}`)
        .send({ displayName: ' Anna Weber-Schmidt ' })
        .expect(200);
      expect(renamed.body.displayName).toBe('Anna Weber-Schmidt');
      await admin()
        .patch(`/shop-users/${user.id}`)
        .send({ email: 'x@y.example' })
        .expect(400);
      await admin()
        .patch(`/shop-users/${user.id}`)
        .send({ accountCustomerNumber: 'JP-1000' })
        .expect(400);
      await admin()
        .patch(`/shop-users/${user.id}`)
        .send({ status: 'LOCKED' })
        .expect(400);
      await admin()
        .patch(`/shop-users/${user.id}`)
        .send({ displayName: '' })
        .expect(422);
    });
  });

  describe('account context of the shop /shop/v1/account', () => {
    it('returns exactly the customer fields; the selection comes from the assignments', async () => {
      const user = await anna();
      const session = await signIn(user);
      const response = await context(session, 'UNIT-MUENCHEN').expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(Object.keys(response.body).sort()).toEqual([
        'expiresAt',
        'requestedUnitRejected',
        'selectedUnit',
        'units',
        'user',
      ]);
      expect(response.body.units).toEqual([
        {
          unitId: 'UNIT-MUENCHEN',
          name: 'Müller UNIT-MUENCHEN',
          canOrder: true,
        },
        {
          unitId: 'UNIT-STUTTGART',
          name: 'Müller UNIT-STUTTGART',
          canOrder: true,
        },
      ]);
      expect(response.body.selectedUnit).toEqual(response.body.units[0]);
      expect(response.body.requestedUnitRejected).toBe(false);
      expect(response.body.user).toEqual({
        email: 'anna.weber@mueller.example',
        displayName: 'Anna Weber',
        role: 'BUYER',
        account: { customerNumber: 'CUST-1000', name: expect.any(String) },
      });
      // Several units and no choice: the user chooses
      const none = await context(session).expect(200);
      expect(none.body.selectedUnit).toBeNull();
      expect(none.body.requestedUnitRejected).toBe(false);
    });

    it('never selects a unit of another account or an unassigned one', async () => {
      const user = await anna(['UNIT-STUTTGART']);
      const session = await signIn(user);
      for (const unit of [
        'UNIT-OSAKA',
        'UNIT-MUENCHEN',
        'unit-stuttgart',
        'UNIT-STUTTGART-X',
        "' OR 1=1 --",
      ]) {
        const response = await context(session, unit).expect(200);
        // The only assigned unit, never the requested one
        expect(response.body.selectedUnit?.unitId).toBe('UNIT-STUTTGART');
        expect(response.body.requestedUnitRejected).toBe(true);
        expect(JSON.stringify(response.body)).not.toContain('OSAKA');
      }
    });

    it('takes a withdrawn unit away with the next request', async () => {
      const user = await anna();
      const session = await signIn(user);
      expect(
        (await context(session, 'UNIT-MUENCHEN').expect(200)).body.selectedUnit
          .unitId,
      ).toBe('UNIT-MUENCHEN');
      await admin()
        .delete(`/shop-users/${user.id}/units/UNIT-MUENCHEN`)
        .expect(200);
      const after = await context(session, 'UNIT-MUENCHEN').expect(200);
      expect(after.body.units.map((u: { unitId: string }) => u.unitId)).toEqual(
        ['UNIT-STUTTGART'],
      );
      expect(after.body.selectedUnit.unitId).toBe('UNIT-STUTTGART');
      expect(after.body.requestedUnitRejected).toBe(true);
    });

    it('never answers with a unit after it was withdrawn, also under concurrent requests', async () => {
      const user = await anna();
      const session = await signIn(user);
      const reads = Array.from({ length: 8 }, () =>
        context(session, 'UNIT-MUENCHEN'),
      );
      const [withdrawn] = await Promise.all([
        admin().delete(`/shop-users/${user.id}/units/UNIT-MUENCHEN`),
        ...reads,
      ]);
      expect(withdrawn.status).toBe(200);
      for (let i = 0; i < 5; i++) {
        const response = await context(session, 'UNIT-MUENCHEN').expect(200);
        expect(response.body.selectedUnit.unitId).not.toBe('UNIT-MUENCHEN');
      }
    });

    it('shows an inactive unit as view only; it stays selectable for viewing', async () => {
      const user = await anna();
      const session = await signIn(user);
      await prisma.b2bUnit.update({
        where: { unitId: 'UNIT-MUENCHEN' },
        data: { isActive: false },
      });
      const response = await context(session, 'UNIT-MUENCHEN').expect(200);
      expect(response.body.selectedUnit).toEqual({
        unitId: 'UNIT-MUENCHEN',
        name: 'Müller UNIT-MUENCHEN',
        canOrder: false,
      });
    });

    it('needs the service key and a valid session; disabled users and inactive accounts are refused', async () => {
      const user = await anna();
      const session = await signIn(user);
      await http()
        .get('/shop/v1/account')
        .set('x-shop-session', session)
        .expect(401);
      await shop('get', '/account').expect(401);
      await shop('get', '/account')
        .set('x-shop-session', 'x'.repeat(43))
        .expect(401);

      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: false },
      });
      await context(session).expect(401);
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: true },
      });
      // Reactivating the account restores no session
      await context(session).expect(401);
    });
  });

  describe('local-only boundary', () => {
    it('refuses requests addressed to another host name (DNS rebinding)', async () => {
      const user = await anna();
      for (const path of [
        '/shop-users',
        `/shop-users/${user.id}`,
        '/materials',
      ]) {
        const response = await http()
          .get(path)
          .set('Host', 'attacker.example:3000')
          .expect(403);
        expect(response.body).toEqual({
          statusCode: 403,
          message: 'Request not allowed.',
        });
      }
      await http()
        .post(`/shop-users/${user.id}/activation-link`)
        .set('Host', 'localhost.attacker.example:3000')
        .expect(403);
      expect(await prisma.shopActivationToken.count()).toBe(0);
      await http().get('/shop-users').set('Host', 'localhost:3000').expect(200);
    });

    it('is not reachable through the shop API namespace', async () => {
      for (const path of ['/shop/v1/shop-users', '/shop/v1/../shop-users']) {
        await http().get(path).set(SHOP_SERVICE_KEY_HEADER, KEY).expect(404);
      }
    });
  });
});
