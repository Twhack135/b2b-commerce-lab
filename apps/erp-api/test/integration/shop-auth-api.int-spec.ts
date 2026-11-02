import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ShopAuthService } from '../../src/shop/auth/shop-auth.service';
import { tokenHash } from '../../src/shop/auth/tokens';
import { SHOP_SERVICE_KEY_HEADER } from '../../src/shop/shop-service-key';
import { ShopUsersService } from '../../src/shop/users/shop-users.service';
import {
  createJapanData,
  createMuellerData,
  createTestApp,
  resetDatabase,
  TestClock,
} from './helpers';

// Shop sign-in (Sprint 12B): activation, login, sessions and logout under
// /shop/v1/auth. Tokens only exist in memory here; they are never printed.

const KEY = randomBytes(32).toString('hex');
const START = '2026-11-15T09:00:00.000Z';
const PASSWORD = 'warm winter heat pump 2026';
const MINUTE = 60_000;

const GENERIC_LOGIN_FAILURE = {
  statusCode: 401,
  message: 'Invalid e-mail address or password.',
  error: 'Unauthorized',
};
const INVALID_ACTIVATION = {
  statusCode: 400,
  code: 'ACTIVATION_INVALID',
  message: ['The activation link is invalid or has expired.'],
  error: 'Bad Request',
};

describe('Shop sign-in /shop/v1/auth (Sprint 12B)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];
  let users: ShopUsersService;
  let auth: ShopAuthService;
  const clock = new TestClock(new Date(START));
  /** A fresh client address per test keeps the address limits apart */
  let address = 1;
  /**
   * Each test starts one day after the previous one: the in-memory attempt
   * limits of earlier tests (15-minute windows) have expired by then
   */
  let base = Date.parse(START);
  const at = (ms: number) => new Date(base + ms).toISOString();

  beforeAll(async () => {
    const previous = process.env.SHOP_SERVICE_KEY;
    process.env.SHOP_SERVICE_KEY = KEY;
    try {
      ({ app, prisma, http } = await createTestApp({ clock }));
    } finally {
      if (previous === undefined) delete process.env.SHOP_SERVICE_KEY;
      else process.env.SHOP_SERVICE_KEY = previous;
    }
    users = app.get(ShopUsersService);
    auth = app.get(ShopAuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    address += 1;
    base = Date.parse(START) + address * 24 * 60 * MINUTE;
    clock.set(at(0));
    await resetDatabase(prisma);
    await createMuellerData(prisma);
    await createJapanData(prisma);
  });

  const client = () => `10.0.0.${address}`;
  const post = (
    path: string,
    body: object,
    headers: Record<string, string> = {},
  ) =>
    http()
      .post(`/shop/v1/auth/${path}`)
      .set(SHOP_SERVICE_KEY_HEADER, KEY)
      .set('x-shop-client-address', client())
      .set(headers)
      .send(body);
  const session = (token?: string) => {
    const request = http()
      .get('/shop/v1/auth/session')
      .set(SHOP_SERVICE_KEY_HEADER, KEY);
    return token ? request.set('x-shop-session', token) : request;
  };
  const advance = (ms: number) =>
    clock.set(new Date(clock.now().getTime() + ms).toISOString());

  /** An activated user of CUST-1000 (or another account) with units */
  async function activeUser(
    email = 'anna.weber@mueller.example',
    account = 'CUST-1000',
    units = ['UNIT-STUTTGART'],
  ) {
    const user = await users.createUser({
      accountCustomerNumber: account,
      email,
      displayName: 'Anna Weber',
    });
    for (const unitId of units) await users.assignUnit(user.id, unitId);
    const { token } = await auth.issueActivation(user.id);
    await post('activation', { token, password: PASSWORD }).expect(204);
    return user;
  }

  async function login(
    email = 'anna.weber@mueller.example',
    password = PASSWORD,
  ) {
    const response = await post('login', { email, password }).expect(200);
    return response.body as {
      sessionToken: string;
      expiresAt: string;
      user: unknown;
    };
  }

  describe('activation', () => {
    it('sets the first password once; only an Argon2id hash is stored', async () => {
      const user = await users.createUser({
        accountCustomerNumber: 'CUST-1000',
        email: 'anna@mueller.example',
        displayName: 'Anna',
      });
      const { token, expiresAt } = await auth.issueActivation(user.id);
      expect(expiresAt.toISOString()).toBe(at(24 * 60 * MINUTE));
      const stored = await prisma.shopActivationToken.findFirstOrThrow();
      expect(stored.tokenHash).toBe(tokenHash(token));
      expect(JSON.stringify(stored)).not.toContain(token);

      const response = await post('activation', {
        token,
        password: PASSWORD,
      }).expect(204);
      expect(response.headers['cache-control']).toBe('no-store');
      const credential = await prisma.shopUserCredential.findUniqueOrThrow({
        where: { userId: user.id },
      });
      expect(credential.passwordHash).toMatch(
        /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
      );
      expect(credential.passwordHash).not.toContain(PASSWORD);
      expect(
        (await prisma.shopActivationToken.findFirstOrThrow()).usedAt,
      ).not.toBeNull();

      // Single use
      expect(
        (await post('activation', { token, password: PASSWORD }).expect(400))
          .body,
      ).toEqual(INVALID_ACTIVATION);
    });

    it('answers unknown, malformed, used and expired links the same way', async () => {
      const user = await users.createUser({
        accountCustomerNumber: 'CUST-1000',
        email: 'a@mueller.example',
        displayName: 'A',
      });
      const { token } = await auth.issueActivation(user.id);
      advance(24 * 60 * MINUTE);
      for (const candidate of [
        token,
        'x',
        randomBytes(32).toString('base64url'),
        "' OR 1=1 --",
      ]) {
        expect(
          (
            await post('activation', {
              token: candidate,
              password: PASSWORD,
            }).expect(400)
          ).body,
        ).toEqual(INVALID_ACTIVATION);
      }
      expect(await prisma.shopUserCredential.count()).toBe(0);
    });

    it('redeems a link exactly once when it is submitted many times at once', async () => {
      const user = await users.createUser({
        accountCustomerNumber: 'CUST-1000',
        email: 'race@mueller.example',
        displayName: 'Race',
      });
      const { token } = await auth.issueActivation(user.id);
      const statuses = (
        await Promise.all(
          Array.from({ length: 6 }, (_, i) =>
            post('activation', { token, password: `${PASSWORD} ${i}` }),
          ),
        )
      ).map((r) => r.status);
      expect(statuses.filter((s) => s === 204)).toHaveLength(1);
      expect(statuses.filter((s) => s === 400)).toHaveLength(5);
      expect(await prisma.shopUserCredential.count()).toBe(1);
    });

    it('explains the password rules and keeps the link usable', async () => {
      const user = await users.createUser({
        accountCustomerNumber: 'CUST-1000',
        email: 'rules@mueller.example',
        displayName: 'Rules',
      });
      const { token } = await auth.issueActivation(user.id);
      const response = await post('activation', {
        token,
        password: 'too short',
      }).expect(400);
      expect(response.body).toEqual({
        statusCode: 400,
        code: 'PASSWORD_POLICY',
        message: ['The password must have at least 15 characters.'],
        error: 'Bad Request',
      });
      await post('activation', { token, password: PASSWORD }).expect(204);
    });

    it('replaces an earlier link and refuses links for users who may not activate', async () => {
      const user = await users.createUser({
        accountCustomerNumber: 'CUST-1000',
        email: 'b@mueller.example',
        displayName: 'B',
      });
      const first = await auth.issueActivation(user.id);
      const second = await auth.issueActivation(user.id);
      await post('activation', {
        token: first.token,
        password: PASSWORD,
      }).expect(400);
      await post('activation', {
        token: second.token,
        password: PASSWORD,
      }).expect(204);
      await expect(auth.issueActivation(user.id)).rejects.toMatchObject({
        reason: 'ALREADY_ACTIVATED',
      });

      const disabled = await users.createUser({
        accountCustomerNumber: 'CUST-1000',
        email: 'c@mueller.example',
        displayName: 'C',
      });
      await users.setStatus(disabled.id, 'DISABLED');
      await expect(auth.issueActivation(disabled.id)).rejects.toMatchObject({
        reason: 'USER_DISABLED',
      });
      await expect(auth.issueActivation('not-a-uuid')).rejects.toMatchObject({
        reason: 'USER_NOT_FOUND',
      });
    });

    it('does not activate a user who was disabled or whose account became inactive', async () => {
      const user = await users.createUser({
        accountCustomerNumber: 'CUST-1000',
        email: 'd@mueller.example',
        displayName: 'D',
      });
      const { token } = await auth.issueActivation(user.id);
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: false },
      });
      expect(
        (await post('activation', { token, password: PASSWORD }).expect(400))
          .body,
      ).toEqual(INVALID_ACTIVATION);
      await expect(auth.issueActivation(user.id)).rejects.toMatchObject({
        reason: 'ACCOUNT_INACTIVE',
      });
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: true },
      });
      await users.setStatus(user.id, 'DISABLED');
      expect(
        (await post('activation', { token, password: PASSWORD }).expect(400))
          .body,
      ).toEqual(INVALID_ACTIVATION);
      expect(await prisma.shopUserCredential.count()).toBe(0);
    });

    it('slows down guessing: 10 failed activations per client address', async () => {
      const user = await users.createUser({
        accountCustomerNumber: 'CUST-1000',
        email: 'e@mueller.example',
        displayName: 'E',
      });
      const { token } = await auth.issueActivation(user.id);
      for (let i = 0; i < 10; i++) {
        await post('activation', {
          token: randomBytes(32).toString('base64url'),
          password: PASSWORD,
        }).expect(400);
      }
      const blocked = await post('activation', {
        token,
        password: PASSWORD,
      }).expect(429);
      expect(blocked.body.message).toBe(
        'Too many attempts. Please wait a few minutes and try again.',
      );
      // Another address is not affected
      await post(
        'activation',
        { token, password: PASSWORD },
        { 'x-shop-client-address': '10.9.9.9' },
      ).expect(204);
    });
  });

  describe('login', () => {
    it('signs in and returns a session for the BFF, without any secret data', async () => {
      await activeUser();
      const response = await post('login', {
        email: ' Anna.Weber@MUELLER.example ',
        password: PASSWORD,
      }).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        sessionToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        expiresAt: at(10 * 60 * MINUTE),
        user: {
          email: 'anna.weber@mueller.example',
          displayName: 'Anna Weber',
          role: 'BUYER',
          account: { customerNumber: 'CUST-1000', name: 'Customer CUST-1000' },
        },
      });
      const text = JSON.stringify(response.body);
      for (const secret of [
        'argon2',
        'passwordHash',
        'tokenHash',
        PASSWORD,
        'requestId',
      ]) {
        expect(text).not.toContain(secret);
      }
      const stored = await prisma.shopSession.findFirstOrThrow();
      expect(stored.tokenHash).toBe(tokenHash(response.body.sessionToken));
    });

    it('fails the same way for every reason', async () => {
      const user = await activeUser();
      await users.createUser({
        accountCustomerNumber: 'CUST-1000',
        email: 'new@mueller.example',
        displayName: 'Not activated',
      });
      const answers = [
        await post('login', {
          email: 'anna.weber@mueller.example',
          password: 'wrong password 123456',
        }),
        await post('login', {
          email: 'nobody@mueller.example',
          password: PASSWORD,
        }),
        await post('login', { email: 'not an e-mail', password: PASSWORD }),
        await post('login', {
          email: 'new@mueller.example',
          password: PASSWORD,
        }),
      ];
      await users.setStatus(user.id, 'DISABLED');
      answers.push(
        await post('login', {
          email: 'anna.weber@mueller.example',
          password: PASSWORD,
        }),
      );
      await users.setStatus(user.id, 'ACTIVE');
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: false },
      });
      answers.push(
        await post('login', {
          email: 'anna.weber@mueller.example',
          password: PASSWORD,
        }),
      );
      for (const answer of answers) {
        expect([answer.status, answer.body]).toEqual([
          401,
          GENERIC_LOGIN_FAILURE,
        ]);
      }
      expect(await prisma.shopSession.count()).toBe(0);
    });

    it('locks an e-mail address after 5 failures, also for the right password, until the window ends', async () => {
      await activeUser();
      for (let i = 0; i < 5; i++) {
        await post(
          'login',
          {
            email: 'anna.weber@mueller.example',
            password: `wrong password ${i}xxxx`,
          },
          { 'x-shop-client-address': `10.1.1.${i}` },
        ).expect(401);
      }
      await post('login', {
        email: 'ANNA.WEBER@mueller.example',
        password: PASSWORD,
      }).expect(429);
      advance(15 * MINUTE);
      await post('login', {
        email: 'anna.weber@mueller.example',
        password: PASSWORD,
      }).expect(200);
    });

    it('locks an address after 30 failures, across e-mail addresses', async () => {
      await activeUser();
      for (let i = 0; i < 30; i++) {
        await post('login', {
          email: `guess${i}@mueller.example`,
          password: PASSWORD,
        }).expect(401);
      }
      await post('login', {
        email: 'anna.weber@mueller.example',
        password: PASSWORD,
      }).expect(429);
      await post(
        'login',
        { email: 'anna.weber@mueller.example', password: PASSWORD },
        { 'x-shop-client-address': '10.8.8.8' },
      ).expect(200);
    });

    it('ends the previous session of the browser at sign-in (no session fixation)', async () => {
      await activeUser();
      const first = await login();
      const second = (
        await post(
          'login',
          { email: 'anna.weber@mueller.example', password: PASSWORD },
          { 'x-shop-session': first.sessionToken },
        ).expect(200)
      ).body as { sessionToken: string };
      expect(second.sessionToken).not.toBe(first.sessionToken);
      await session(first.sessionToken).expect(401);
      await session(second.sessionToken).expect(200);
    });
  });

  describe('sessions', () => {
    it('returns the signed-in user with their own units only', async () => {
      await activeUser('anna.weber@mueller.example', 'CUST-1000', [
        'UNIT-STUTTGART',
      ]);
      await activeUser('kenji@osaka.example', 'JP-1000', ['UNIT-OSAKA']);
      const anna = await login();
      const kenji = await login('kenji@osaka.example');

      const response = await session(anna.sessionToken).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        user: {
          email: 'anna.weber@mueller.example',
          displayName: 'Anna Weber',
          role: 'BUYER',
          account: { customerNumber: 'CUST-1000', name: 'Customer CUST-1000' },
        },
        units: [
          {
            unitId: 'UNIT-STUTTGART',
            name: 'Müller UNIT-STUTTGART',
            canOrder: true,
          },
        ],
        expiresAt: at(10 * 60 * MINUTE),
      });
      expect(
        (await session(kenji.sessionToken).expect(200)).body,
      ).toMatchObject({
        user: { account: { customerNumber: 'JP-1000' } },
        units: [{ unitId: 'UNIT-OSAKA' }],
      });
      // Query parameters cannot select another user
      await http()
        .get('/shop/v1/auth/session?userId=x&account=JP-1000')
        .set(SHOP_SERVICE_KEY_HEADER, KEY)
        .set('x-shop-session', anna.sessionToken)
        .expect(200)
        .expect((r) =>
          expect(r.body.user.email).toBe('anna.weber@mueller.example'),
        );
    });

    it('requires a valid session and the service key', async () => {
      await activeUser();
      const { sessionToken } = await login();
      const authRequired = {
        statusCode: 401,
        message: 'Authentication required.',
        error: 'Unauthorized',
      };
      expect((await session().expect(401)).body).toEqual(authRequired);
      for (const token of [
        'x',
        randomBytes(32).toString('base64url'),
        tokenHash(sessionToken),
      ]) {
        expect((await session(token).expect(401)).body).toEqual(authRequired);
      }
      // The session alone is not enough: the service key is required as well
      await http()
        .get('/shop/v1/auth/session')
        .set('x-shop-session', sessionToken)
        .expect(401);
      for (const path of ['login', 'activation', 'logout']) {
        await http().post(`/shop/v1/auth/${path}`).send({}).expect(401);
      }
    });

    it('ends after 30 idle minutes; activity keeps it alive', async () => {
      await activeUser();
      const { sessionToken } = await login();
      advance(29 * MINUTE);
      await session(sessionToken).expect(200);
      advance(29 * MINUTE);
      await session(sessionToken).expect(200);
      advance(30 * MINUTE);
      await session(sessionToken).expect(401);
    });

    it('ends 10 hours after sign-in, even when active', async () => {
      await activeUser();
      const { sessionToken } = await login();
      // Active every 20 minutes until 9 h 40 min after sign-in
      for (let i = 0; i < 29; i++) {
        advance(20 * MINUTE);
        await session(sessionToken).expect(200);
      }
      advance(19 * MINUTE + 59_000);
      await session(sessionToken).expect(200);
      // 10 h 0 min 59 s after sign-in, only 1 minute idle: ended anyway
      advance(MINUTE);
      await session(sessionToken).expect(401);
    });

    it('signs out: the token cannot be replayed, signing out twice is fine', async () => {
      await activeUser();
      const { sessionToken } = await login();
      await post('logout', {}, { 'x-shop-session': sessionToken }).expect(204);
      await session(sessionToken).expect(401);
      await post('logout', {}, { 'x-shop-session': sessionToken }).expect(204);
      await post('logout', {}).expect(204);
      expect(
        (await prisma.shopSession.findFirstOrThrow()).revokedAt,
      ).not.toBeNull();
    });

    it('ends the authorization at once when the user is disabled or the account inactive', async () => {
      const user = await activeUser();
      const first = await login();
      await users.setStatus(user.id, 'DISABLED');
      await session(first.sessionToken).expect(401);
      // Enabling again does not revive the old session
      await users.setStatus(user.id, 'ACTIVE');
      await session(first.sessionToken).expect(401);

      const second = await login();
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: false },
      });
      await session(second.sessionToken).expect(401);
    });

    it('shows units of the session only while they are assigned', async () => {
      const user = await activeUser('anna.weber@mueller.example', 'CUST-1000', [
        'UNIT-STUTTGART',
        'UNIT-MUENCHEN',
      ]);
      const { sessionToken } = await login();
      expect((await session(sessionToken).expect(200)).body.units).toHaveLength(
        2,
      );
      await users.unassignUnit(user.id, 'UNIT-MUENCHEN');
      expect((await session(sessionToken).expect(200)).body.units).toEqual([
        {
          unitId: 'UNIT-STUTTGART',
          name: 'Müller UNIT-STUTTGART',
          canOrder: true,
        },
      ]);
    });
  });

  it('never echoes a password in validation errors', async () => {
    const password = 'p'.repeat(1025);
    const response = await post('login', {
      email: 'x@mueller.example',
      password,
    }).expect(400);
    expect(JSON.stringify(response.body)).not.toContain('pppppppp');
    const activation = await post('activation', {
      token: 'x',
      password,
      extra: 1,
    }).expect(400);
    expect(JSON.stringify(activation.body)).not.toContain('pppppppp');
  });

  describe('rate limits under pressure', () => {
    /** A sign-in without client address (the BFF knows none it can trust) */
    const unattributed = (email: string, password: string) =>
      http()
        .post('/shop/v1/auth/login')
        .set(SHOP_SERVICE_KEY_HEADER, KEY)
        .send({ email, password });

    it('counts concurrent attempts: of 20 at once for one e-mail address only 5 are checked', async () => {
      await activeUser();
      const answers = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          post(
            'login',
            {
              email: 'anna.weber@mueller.example',
              password: `wrong password ${i}xx`,
            },
            { 'x-shop-client-address': `10.6.0.${i}` },
          ),
        ),
      );
      const statuses = answers.map((r) => r.status);
      expect(statuses.filter((s) => s === 401)).toHaveLength(5);
      expect(statuses.filter((s) => s === 429)).toHaveLength(15);
      await post('login', {
        email: 'anna.weber@mueller.example',
        password: PASSWORD,
      }).expect(429);
    });

    it('limits sign-ins without a trusted client address together: 50 failures in 15 minutes', async () => {
      await activeUser();
      for (let i = 0; i < 50; i++) {
        await unattributed(`guess${i}@mueller.example`, PASSWORD).expect(401);
      }
      await unattributed('anna.weber@mueller.example', PASSWORD).expect(429);
      // A request with a client address the BFF trusts is counted separately
      await post('login', {
        email: 'anna.weber@mueller.example',
        password: PASSWORD,
      }).expect(200);
      advance(15 * MINUTE);
      await unattributed('anna.weber@mueller.example', PASSWORD).expect(200);
    });

    it('does not count successful sign-ins against the shared limits', async () => {
      await activeUser();
      for (let i = 0; i < 60; i++) {
        await unattributed('anna.weber@mueller.example', PASSWORD).expect(200);
      }
    });

    it('keeps its limits in memory only: a restarted ERP process starts again (development only)', async () => {
      await activeUser();
      for (let i = 0; i < 5; i++) {
        await post('login', {
          email: 'anna.weber@mueller.example',
          password: `wrong password ${i}xx`,
        }).expect(401);
      }
      await post('login', {
        email: 'anna.weber@mueller.example',
        password: PASSWORD,
      }).expect(429);

      // A second, freshly started ERP process on the same database
      const previous = process.env.SHOP_SERVICE_KEY;
      process.env.SHOP_SERVICE_KEY = KEY;
      const restarted = await createTestApp({ clock });
      if (previous === undefined) delete process.env.SHOP_SERVICE_KEY;
      else process.env.SHOP_SERVICE_KEY = previous;
      try {
        await restarted
          .http()
          .post('/shop/v1/auth/login')
          .set(SHOP_SERVICE_KEY_HEADER, KEY)
          .set('x-shop-client-address', client())
          .send({ email: 'anna.weber@mueller.example', password: PASSWORD })
          .expect(200);
      } finally {
        await restarted.app.close();
      }
    });
  });

  describe('account and user deactivation end sessions for good', () => {
    const setAccountActive = (isActive: boolean) =>
      http().patch('/customers/CUST-1000').send({ isActive }).expect(200);
    const revokedCount = () =>
      prisma.shopSession.count({ where: { revokedAt: { not: null } } });

    it('revokes every session of the account when it is deactivated; reactivation restores none', async () => {
      await activeUser('anna.weber@mueller.example');
      await activeUser('ben@mueller.example', 'CUST-1000', ['UNIT-MUENCHEN']);
      await activeUser('kenji@osaka.example', 'JP-1000', ['UNIT-OSAKA']);
      const anna = await login('anna.weber@mueller.example');
      const ben = await login('ben@mueller.example');
      const kenji = await login('kenji@osaka.example');

      await setAccountActive(false);
      expect(await revokedCount()).toBe(2);
      await setAccountActive(true);

      await session(anna.sessionToken).expect(401);
      await session(ben.sessionToken).expect(401);
      // Another account is not affected
      await session(kenji.sessionToken).expect(200);
      // A new sign-in works again
      const fresh = await login('anna.weber@mueller.example');
      await session(fresh.sessionToken).expect(200);
    });

    it('also when the account is deactivated outside the API (database)', async () => {
      await activeUser();
      const { sessionToken } = await login();
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: false },
      });
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: true },
      });
      await session(sessionToken).expect(401);
    });

    it('does not end sessions when only a member customer (not the account) is deactivated', async () => {
      await activeUser();
      const { sessionToken } = await login();
      await http()
        .patch('/customers/CUST-1100')
        .send({ isActive: false })
        .expect(200);
      await session(sessionToken).expect(200);
      expect(await revokedCount()).toBe(0);
    });

    it('revokes the sessions of a user disabled outside the service (database)', async () => {
      const user = await activeUser();
      const { sessionToken } = await login();
      await prisma.shopUser.update({
        where: { id: user.id },
        data: { status: 'DISABLED' },
      });
      await prisma.shopUser.update({
        where: { id: user.id },
        data: { status: 'ACTIVE' },
      });
      await session(sessionToken).expect(401);
    });

    it('leaves no session behind that reactivation could restore, when sign-ins and deactivation run at the same time', async () => {
      const emails = Array.from(
        { length: 8 },
        (_, i) => `user${i}@mueller.example`,
      );
      for (const email of emails) await activeUser(email);
      const attempts = emails.map((email, i) =>
        post(
          'login',
          { email, password: PASSWORD },
          { 'x-shop-client-address': `10.7.0.${i}` },
        ),
      );
      const [answers] = await Promise.all([
        Promise.all(attempts),
        setAccountActive(false),
      ]);
      await setAccountActive(true);

      const tokens = answers
        .filter((r) => r.status === 200)
        .map((r) => (r.body as { sessionToken: string }).sessionToken);
      for (const token of tokens) await session(token).expect(401);
      // Every sign-in either failed or produced a session that is revoked now
      expect(answers.every((r) => r.status === 200 || r.status === 401)).toBe(
        true,
      );
      expect(
        await prisma.shopSession.count({ where: { revokedAt: null } }),
      ).toBe(0);
    });
  });

  it('never stores raw tokens or passwords', async () => {
    await activeUser();
    const { sessionToken } = await login();
    const tables = await prisma.$queryRaw<{ data: string }[]>`
      SELECT (SELECT coalesce(json_agg(t), '[]') FROM shop_sessions t)::text
          || (SELECT coalesce(json_agg(t), '[]') FROM shop_activation_tokens t)::text
          || (SELECT coalesce(json_agg(t), '[]') FROM shop_user_credentials t)::text AS data`;
    expect(tables[0].data).not.toContain(sessionToken);
    expect(tables[0].data).not.toContain(PASSWORD);
  });
});
