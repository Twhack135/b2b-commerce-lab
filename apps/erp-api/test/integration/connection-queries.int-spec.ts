import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PrismaService } from '../../src/prisma/prisma.service';
import { UNIT_INCLUDE } from '../../src/sales-orders/simulation-rules';
import {
  createMuellerData,
  createTestApp,
  GERMANY,
  resetDatabase,
  TestClock,
} from './helpers';

// pg warns "Calling client.query() when the client is already executing a
// query is deprecated" when a query is queued on a connection that already
// has a queued query. Inside an interactive transaction all queries share
// one connection, so Prisma's parallel queries for sibling relations of an
// include caused this. These tests count exactly that situation. The control
// test provokes it on purpose, so this file prints the warning once.
describe('Queries on one connection (pg deprecation)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];
  let queued: number;

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp({
      clock: new TestClock(new Date('2026-11-15T10:00:00Z')),
    }));
    // The original method, called below with the client as `this`
    const query = Object.getOwnPropertyDescriptor(Client.prototype, 'query')
      ?.value as (...args: unknown[]) => unknown;
    jest.spyOn(Client.prototype, 'query').mockImplementation(function (
      this: Client,
      ...args: unknown[]
    ) {
      // The condition under which pg prints the deprecation warning
      const internals = this as unknown as {
        _queryQueue?: unknown[];
        pipeline?: boolean;
      };
      if ((internals._queryQueue?.length ?? 0) > 0 && !internals.pipeline) {
        queued++;
      }
      return query.apply(this, args);
    } as typeof Client.prototype.query);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMuellerData(prisma);
    queued = 0;
  });

  const order = {
    ...GERMANY,
    unitId: 'UNIT-STUTTGART',
    items: [
      { materialNumber: 'MAT-001', quantity: 2 },
      { materialNumber: 'MAT-002', quantity: 10 },
    ],
  };

  it('detects the situation (control: an include with sibling relations in a transaction)', async () => {
    await prisma.$transaction((tx) =>
      tx.b2bUnit.findUnique({
        where: { unitId: 'UNIT-STUTTGART' },
        include: UNIT_INCLUDE,
      }),
    );
    expect(queued).toBeGreaterThan(0);
  });

  it('never queues queries on the connection during a simulation', async () => {
    const response = await http()
      .post('/sales-orders/simulate')
      .send({ ...order, pricingDate: '2026-11-15' })
      .expect(200);
    expect(response.body.totals.netValue).toBe('10895.00');
    expect(queued).toBe(0);
  });

  it('never queues queries on the connection while creating an order', async () => {
    await http()
      .post('/sales-orders')
      .send({
        ...order,
        requestId: randomUUID(),
        items: [
          { ...order.items[0], expectedUnitPrice: '4500.00' },
          { ...order.items[1], expectedUnitPrice: '189.50' },
        ],
        expectedTotal: { netValue: '10895.00', currency: 'EUR' },
      })
      .expect(201);
    expect(queued).toBe(0);
  });
});
