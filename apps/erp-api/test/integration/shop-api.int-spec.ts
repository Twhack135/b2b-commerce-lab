import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { SHOP_SERVICE_KEY_HEADER } from '../../src/shop/shop-service-key';
import { createTestApp, tableFingerprint } from './helpers';

// The shop API /shop/v1 (Sprint 11): a separate, service-authenticated
// namespace with a technical health check only. No customer data.

const KEY = randomBytes(32).toString('hex');

/** The app with SHOP_SERVICE_KEY set to `key` (or unset) at startup */
async function appWithKey(key: string | undefined) {
  const previous = process.env.SHOP_SERVICE_KEY;
  if (key === undefined) delete process.env.SHOP_SERVICE_KEY;
  else process.env.SHOP_SERVICE_KEY = key;
  try {
    return await createTestApp();
  } finally {
    if (previous === undefined) delete process.env.SHOP_SERVICE_KEY;
    else process.env.SHOP_SERVICE_KEY = previous;
  }
}

describe('Shop API /shop/v1', () => {
  describe('with a configured service key', () => {
    let app: INestApplication;
    let http: Awaited<ReturnType<typeof createTestApp>>['http'];
    let prisma: Awaited<ReturnType<typeof createTestApp>>['prisma'];

    beforeAll(async () => {
      ({ app, http, prisma } = await appWithKey(KEY));
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers the health check of the shop BFF, without any details', async () => {
      const response = await http()
        .get('/shop/v1/health')
        .set(SHOP_SERVICE_KEY_HEADER, KEY)
        .expect(200);
      expect(response.body).toEqual({ status: 'ok' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it.each([
      ['no key', {}],
      ['a wrong key', { [SHOP_SERVICE_KEY_HEADER]: 'x'.repeat(64) }],
      [
        'the key with a different case',
        { [SHOP_SERVICE_KEY_HEADER]: KEY.toUpperCase() },
      ],
      [
        'the key as a bearer token (it is no user credential)',
        { authorization: `Bearer ${KEY}` },
      ],
    ])('answers 401 for %s, saying nothing more', async (_case, headers) => {
      const response = await http()
        .get('/shop/v1/health')
        .set(headers)
        .expect(401);
      expect(response.body).toEqual({
        statusCode: 401,
        message: 'Service authentication required.',
        error: 'Unauthorized',
      });
    });

    it('never reads the key from the URL', async () => {
      for (const query of [
        `x-shop-service-key=${KEY}`,
        `X-Shop-Service-Key=${KEY}`,
        `key=${KEY}`,
      ]) {
        await http().get(`/shop/v1/health?${query}`).expect(401);
      }
    });

    it('protects every registered /shop route, also future ones', async () => {
      // All routes of the running app, as Express knows them
      const server = app.getHttpAdapter().getInstance() as {
        router: {
          stack: {
            route?: { path: string; methods: Record<string, boolean> };
          }[];
        };
      };
      const shopRoutes = server.router.stack
        .filter(
          (layer) => layer.route && /^\/shop(\/|$)/i.test(layer.route.path),
        )
        .flatMap((layer) =>
          Object.keys(layer.route!.methods).map(
            (method) => [method, layer.route!.path] as const,
          ),
        );
      expect(shopRoutes).toEqual([['get', '/shop/v1/health']]);
      for (const [method, path] of shopRoutes) {
        const request = http()[method as 'get'](path);
        await request.expect(401);
      }
    });

    it.each([
      '/shop/v1/health/',
      '/SHOP/V1/HEALTH',
      '/Shop/v1/Health/',
      '/shop//v1/health',
      '/shop/v1//health',
      '/shop/v1/%68ealth',
      '/shop%2Fv1%2Fhealth',
      '/shop/v1/health;x',
      '/shop/v1/health%00',
      '/shop/v1/./health',
      '/shop/v1/health/.',
      '//shop/v1/health',
    ])('cannot be reached without the key as %s', async (path) => {
      const response = await http().get(path);
      // Either the guarded route (401) or no route at all; never a result
      expect([401, 404]).toContain(response.status);
      expect(JSON.stringify(response.body)).not.toContain('"status":"ok"');
    });

    it('has no other routes and no mutations', async () => {
      for (const [method, path] of [
        ['post', '/shop/v1/health'],
        ['get', '/shop/v1'],
        ['get', '/shop/v1/materials'],
        ['get', '/shop/v1/sales-orders'],
        ['post', '/shop/v1/sales-orders'],
      ] as const) {
        await http()
          [method](path)
          .set(SHOP_SERVICE_KEY_HEADER, KEY)
          .expect(404);
      }
    });

    it('does not open the admin API through the shop namespace', async () => {
      // ".." is not resolved: no admin resource behind the shop namespace
      for (const path of [
        '/shop/v1/../materials',
        '/shop/v1/%2e%2e/materials',
      ]) {
        await http().get(path).set(SHOP_SERVICE_KEY_HEADER, KEY).expect(404);
      }
      await http()
        .get('/shop/v1/customers')
        .set(SHOP_SERVICE_KEY_HEADER, KEY)
        .expect(404);
    });

    it('changes no data', async () => {
      const before = await tableFingerprint(prisma);
      await http()
        .get('/shop/v1/health')
        .set(SHOP_SERVICE_KEY_HEADER, KEY)
        .expect(200);
      await http().get('/shop/v1/health').expect(401);
      expect(await tableFingerprint(prisma)).toEqual(before);
    });

    it('leaves the admin API unchanged, apart from the hardening headers', async () => {
      const response = await http().get('/materials').expect(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe.each([
    ['without SHOP_SERVICE_KEY', undefined],
    ['with a key shorter than 32 characters', 'too-short'],
  ])('%s (fail closed)', (_case, key) => {
    let app: INestApplication;
    let http: Awaited<ReturnType<typeof createTestApp>>['http'];

    beforeAll(async () => {
      ({ app, http } = await appWithKey(key));
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers every shop request with 503, also one with a key', async () => {
      for (const headers of [
        {},
        { [SHOP_SERVICE_KEY_HEADER]: 'too-short' },
        { [SHOP_SERVICE_KEY_HEADER]: KEY },
      ]) {
        const response = await http()
          .get('/shop/v1/health')
          .set(headers)
          .expect(503);
        expect(response.body).toEqual({
          statusCode: 503,
          message: 'The shop API is not available.',
          error: 'Service Unavailable',
        });
      }
    });

    it('keeps the admin API working (the backoffice does not need the key)', async () => {
      await http().get('/materials').expect(200);
    });
  });
});
