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

// Password reset of activated shop users (Sprint 12C, after the manual
// acceptance test, GAP-001): links issued by the local administration,
// redeemed through the shop API. Tokens and passwords only exist in memory
// here; they are never printed.

const KEY = randomBytes(32).toString('hex');
const SHOP_URL = 'http://127.0.0.1:3303';
const START = '2026-12-01T09:00:00.000Z';
const OLD_PASSWORD = 'warm winter heat pump 2026';
const NEW_PASSWORD = 'cold spring brings new valves 2027';
const MINUTE = 60_000;

const RESET_INVALID = {
  statusCode: 400,
  code: 'RESET_INVALID',
  message: ['The password reset link is invalid or has expired.'],
  error: 'Bad Request',
};

describe('Password reset of shop users (Sprint 12C)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];
  const clock = new TestClock(new Date(START));
  const saved: Record<string, string | undefined> = {};
  /** A fresh client address and day per test keeps the attempt limits apart */
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

  const advance = (ms: number) =>
    clock.set(new Date(clock.now().getTime() + ms).toISOString());
  const shop = (path: string) =>
    http()
      .post(`/shop/v1/auth/${path}`)
      .set(SHOP_SERVICE_KEY_HEADER, KEY)
      .set('x-shop-client-address', `10.2.0.${round % 250}`);
  const session = (token: string) =>
    http()
      .get('/shop/v1/auth/session')
      .set(SHOP_SERVICE_KEY_HEADER, KEY)
      .set('x-shop-session', token);
  const login = (email: string, password: string) =>
    shop('login').send({ email, password });
  const tokenOf = (link: string, page: string) => {
    const url = new URL(link);
    expect(url.origin).toBe(SHOP_URL);
    expect(url.pathname).toBe(page);
    expect(url.search).toBe('');
    return url.hash.slice('#token='.length);
  };

  /** A user of CUST-1000, activated with OLD_PASSWORD unless told otherwise */
  async function user(email = 'anna.weber@mueller.example', activate = true) {
    const created = await http()
      .post('/shop-users')
      .send({
        accountCustomerNumber: 'CUST-1000',
        email,
        displayName: 'Anna Weber',
        unitIds: ['UNIT-STUTTGART'],
      })
      .expect(201);
    const id = created.body.id as string;
    if (activate) {
      const link = await http()
        .post(`/shop-users/${id}/activation-link`)
        .expect(201);
      await shop('activation')
        .send({
          token: tokenOf(link.body.activationLink, '/activate'),
          password: OLD_PASSWORD,
        })
        .expect(204);
    }
    return { id, email };
  }

  async function resetToken(id: string) {
    const response = await http()
      .post(`/shop-users/${id}/password-reset-link`)
      .expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(Object.keys(response.body).sort()).toEqual([
      'expiresAt',
      'resetLink',
    ]);
    return tokenOf(response.body.resetLink, '/reset-password');
  }

  describe('issuing a reset link', () => {
    it('returns a 4-hour link once; only its hash is stored and shown as state', async () => {
      const anna = await user();
      const response = await http()
        .post(`/shop-users/${anna.id}/password-reset-link`)
        .expect(201);
      expect(response.body.expiresAt).toBe(
        new Date(clock.now().getTime() + 4 * 60 * MINUTE).toISOString(),
      );
      const token = tokenOf(response.body.resetLink, '/reset-password');
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const stored = await prisma.shopPasswordReset.findFirstOrThrow();
      expect(stored.tokenHash).toBe(tokenHash(token));

      const detail = (await http().get(`/shop-users/${anna.id}`).expect(200))
        .body;
      expect(detail.passwordReset.openLink.expiresAt).toBe(
        response.body.expiresAt,
      );
      const everything = JSON.stringify([
        detail,
        (await http().get('/shop-users').expect(200)).body,
      ]);
      expect(everything).not.toContain(token);
      expect(everything).not.toContain(stored.tokenHash);
      // Activation links are untouched: activation and reset are separate
      expect(
        await prisma.shopActivationToken.count({ where: { usedAt: null } }),
      ).toBe(0);
    });

    it('is refused for users who are not activated, disabled or of an inactive account', async () => {
      const pending = await user('ben@mueller.example', false);
      expect(
        (
          await http()
            .post(`/shop-users/${pending.id}/password-reset-link`)
            .expect(409)
        ).body.message,
      ).toContain('has not set a password yet');

      const anna = await user();
      await http()
        .patch(`/shop-users/${anna.id}`)
        .send({ status: 'DISABLED' })
        .expect(200);
      expect(
        (
          await http()
            .post(`/shop-users/${anna.id}/password-reset-link`)
            .expect(409)
        ).body.message,
      ).toBe('The shop user is disabled. Enable the user first.');
      await http()
        .patch(`/shop-users/${anna.id}`)
        .send({ status: 'ACTIVE' })
        .expect(200);

      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: false },
      });
      await http()
        .post(`/shop-users/${anna.id}/password-reset-link`)
        .expect(409);
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: true },
      });

      await http()
        .post(
          '/shop-users/00000000-0000-4000-8000-000000000000/password-reset-link',
        )
        .expect(404);
      expect(await prisma.shopPasswordReset.count()).toBe(0);
    });

    it('replaces an unused link; the old one stops working', async () => {
      const anna = await user();
      const first = await resetToken(anna.id);
      const second = await resetToken(anna.id);
      expect(
        (
          await shop('password-reset')
            .send({ token: first, password: NEW_PASSWORD })
            .expect(400)
        ).body,
      ).toEqual(RESET_INVALID);
      await shop('password-reset')
        .send({ token: second, password: NEW_PASSWORD })
        .expect(204);
    });

    it('cannot be stored with a lifetime over 4 hours (database CHECK)', async () => {
      const anna = await user();
      const now = clock.now();
      await expect(
        prisma.shopPasswordReset.create({
          data: {
            userId: anna.id,
            tokenHash: 'a'.repeat(64),
            createdAt: now,
            expiresAt: new Date(now.getTime() + 4 * 60 * MINUTE + 1),
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.shopPasswordReset.create({
          data: {
            userId: anna.id,
            tokenHash: 'not a hash',
            createdAt: now,
            expiresAt: new Date(now.getTime() + MINUTE),
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('resetting the password', () => {
    it('sets the new password, ends every session and makes the old password and the link useless', async () => {
      const anna = await user();
      const first = (await login(anna.email, OLD_PASSWORD).expect(200)).body
        .sessionToken as string;
      const second = (await login(anna.email, OLD_PASSWORD).expect(200)).body
        .sessionToken as string;
      const token = await resetToken(anna.id);
      // Until the link is used, the current password stays valid
      await session(first).expect(200);

      await shop('password-reset')
        .send({ token, password: NEW_PASSWORD })
        .expect(204);

      await session(first).expect(401);
      await session(second).expect(401);
      expect(
        await prisma.shopSession.count({ where: { revokedAt: null } }),
      ).toBe(0);
      await login(anna.email, OLD_PASSWORD).expect(401);
      await login(anna.email, NEW_PASSWORD).expect(200);
      expect(
        (
          await shop('password-reset')
            .send({ token, password: `${NEW_PASSWORD}!` })
            .expect(400)
        ).body,
      ).toEqual(RESET_INVALID);
      // Only an Argon2id hash of the new password is stored
      const credential = await prisma.shopUserCredential.findFirstOrThrow();
      expect(credential.passwordHash).toMatch(/^\$argon2id\$v=19\$/);
      expect(credential.passwordHash).not.toContain(NEW_PASSWORD);
      const detail = (await http().get(`/shop-users/${anna.id}`).expect(200))
        .body;
      expect(detail.passwordReset.openLink).toBeNull();
      expect(detail.passwordReset.passwordChangedAt).toBe(
        clock.now().toISOString(),
      );
    });

    it('keeps activation and reset links strictly apart', async () => {
      const anna = await user();
      const reset = await resetToken(anna.id);
      // A reset link cannot activate a new user ...
      const ben = await user('ben@mueller.example', false);
      const benLink = await http()
        .post(`/shop-users/${ben.id}/activation-link`)
        .expect(201);
      const activation = tokenOf(benLink.body.activationLink, '/activate');
      expect(
        (
          await shop('activation')
            .send({ token: reset, password: NEW_PASSWORD })
            .expect(400)
        ).body.code,
      ).toBe('ACTIVATION_INVALID');
      // ... and an activation link cannot reset a password
      expect(
        (
          await shop('password-reset')
            .send({ token: activation, password: NEW_PASSWORD })
            .expect(400)
        ).body,
      ).toEqual(RESET_INVALID);
      // Both links still work for their own purpose
      await shop('activation')
        .send({ token: activation, password: NEW_PASSWORD })
        .expect(204);
      await shop('password-reset')
        .send({ token: reset, password: NEW_PASSWORD })
        .expect(204);
    });

    it('is valid for exactly 4 hours', async () => {
      const anna = await user();
      const ben = await user('ben@mueller.example');
      const early = await resetToken(anna.id);
      const late = await resetToken(ben.id);
      advance(4 * 60 * MINUTE - 1);
      await shop('password-reset')
        .send({ token: early, password: NEW_PASSWORD })
        .expect(204);
      advance(1);
      expect(
        (
          await shop('password-reset')
            .send({ token: late, password: NEW_PASSWORD })
            .expect(400)
        ).body,
      ).toEqual(RESET_INVALID);
      await login(ben.email, OLD_PASSWORD).expect(200);
      expect(
        (await http().get(`/shop-users/${ben.id}`).expect(200)).body
          .passwordReset.openLink,
      ).toBeNull();
    });

    it('does not reset for a disabled user or an inactive account', async () => {
      const anna = await user();
      const token = await resetToken(anna.id);
      await http()
        .patch(`/shop-users/${anna.id}`)
        .send({ status: 'DISABLED' })
        .expect(200);
      expect(
        (
          await shop('password-reset')
            .send({ token, password: NEW_PASSWORD })
            .expect(400)
        ).body,
      ).toEqual(RESET_INVALID);
      await http()
        .patch(`/shop-users/${anna.id}`)
        .send({ status: 'ACTIVE' })
        .expect(200);
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: false },
      });
      await shop('password-reset')
        .send({ token, password: NEW_PASSWORD })
        .expect(400);
      await prisma.customer.update({
        where: { customerNumber: 'CUST-1000' },
        data: { isActive: true },
      });
      await login(anna.email, OLD_PASSWORD).expect(200);
    });

    it('applies the unchanged password rules and keeps the link usable', async () => {
      const anna = await user();
      const token = await resetToken(anna.id);
      for (const password of ['too short', 'passwordpassword', anna.email]) {
        const response = await shop('password-reset')
          .send({ token, password })
          .expect(400);
        expect(response.body.code).toBe('PASSWORD_POLICY');
      }
      await login(anna.email, OLD_PASSWORD).expect(200);
      await shop('password-reset')
        .send({ token, password: NEW_PASSWORD })
        .expect(204);
    });

    it('redeems a link exactly once when it is submitted many times at once', async () => {
      const anna = await user();
      const token = await resetToken(anna.id);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          shop('password-reset').send({
            token,
            password: `${NEW_PASSWORD} ${i}`,
          }),
        ),
      );
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        204, 400, 400, 400, 400, 400, 400, 400,
      ]);
      const winner = results.findIndex((r) => r.status === 204);
      await login(anna.email, `${NEW_PASSWORD} ${winner}`).expect(200);
    });

    it('never lets a sign-in with the old password outlive a reset, also at the same moment', async () => {
      const anna = await user();
      const token = await resetToken(anna.id);
      const attempts = await Promise.all([
        shop('password-reset').send({ token, password: NEW_PASSWORD }),
        // Below the limit of 5 failed sign-ins per e-mail address
        ...Array.from({ length: 4 }, () => login(anna.email, OLD_PASSWORD)),
      ]);
      expect(attempts[0].status).toBe(204);
      // Sessions of old-password sign-ins either were ended by the reset or
      // were refused because the password had changed meanwhile
      for (const attempt of attempts.slice(1)) {
        if (attempt.status === 200)
          await session(attempt.body.sessionToken).expect(401);
        else expect(attempt.status).toBe(401);
      }
      expect(
        await prisma.shopSession.count({ where: { revokedAt: null } }),
      ).toBe(0);
    });

    it('slows down guessing: 10 failed resets per client address', async () => {
      const results: number[] = [];
      for (let i = 0; i < 11; i++) {
        results.push(
          (
            await shop('password-reset').send({
              token: randomBytes(32).toString('base64url'),
              password: NEW_PASSWORD,
            })
          ).status,
        );
      }
      expect(results).toEqual([...Array(10).fill(400), 429]);
    });

    it('unlocks the address after a successful reset', async () => {
      const anna = await user();
      for (let i = 0; i < 5; i++)
        await login(anna.email, 'wrong password 123456').expect(401);
      await login(anna.email, OLD_PASSWORD).expect(429);
      const token = await resetToken(anna.id);
      await shop('password-reset')
        .send({ token, password: NEW_PASSWORD })
        .expect(204);
      await login(anna.email, NEW_PASSWORD).expect(200);
    });
  });

  it('never stores or answers raw tokens or passwords', async () => {
    const anna = await user();
    const token = await resetToken(anna.id);
    const response = await shop('password-reset')
      .send({ token, password: NEW_PASSWORD })
      .expect(204);
    expect(JSON.stringify(response.body)).not.toContain(NEW_PASSWORD);
    const rows = JSON.stringify([
      await prisma.shopPasswordReset.findMany(),
      await prisma.shopUserCredential.findMany(),
    ]);
    expect(rows).not.toContain(token);
    expect(rows).not.toContain(NEW_PASSWORD);
  });
});
