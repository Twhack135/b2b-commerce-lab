import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { calendarDateIn } from '../src/common/dates';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createMuellerData,
  createTestApp,
  GERMANY,
  resetDatabase,
} from './integration/helpers';

// The whole order flow over HTTP with the real clock, as a client uses it:
// simulate, confirm the total, create, read, repeat after a "timeout".
// Runs only against the disposable database of `npm run test:e2e`.
describe('Sales order flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
    await resetDatabase(prisma);
    await createMuellerData(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('simulates, creates, reads and safely repeats an order', async () => {
    const order = {
      ...GERMANY,
      unitId: 'UNIT-STUTTGART',
      customerReference: 'PO-E2E-1',
      items: [
        { materialNumber: 'MAT-001', quantity: 2 },
        { materialNumber: 'MAT-002', quantity: 10 },
      ],
    };
    // The Backoffice simulates on today's date of the market
    const today = calendarDateIn('Europe/Berlin', new Date());
    const simulation = await http()
      .post('/sales-orders/simulate')
      .send({ ...order, pricingDate: today })
      .expect(200);
    expect(simulation.body.status).toBe('VALID');
    // 2 x 4500.00 (list price) + 10 x 189.50 (Sold-to price)
    expect(simulation.body.totals).toMatchObject({
      netValue: '10895.00',
      currency: 'EUR',
    });

    // The client confirms exactly what the simulation showed
    const request = {
      ...order,
      items: order.items.map((item, index) => ({
        ...item,
        expectedUnitPrice: simulation.body.items[index].unitPrice as string,
      })),
      requestId: randomUUID(),
      expectedTotal: {
        netValue: simulation.body.totals.netValue,
        currency: simulation.body.totals.currency,
      },
    };
    const created = await http()
      .post('/sales-orders')
      .send(request)
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'OPEN',
      orderDate: today,
      timeZone: 'Europe/Berlin',
      totals: { netValue: '10895.00', currency: 'EUR' },
    });
    expect(created.body.salesOrderNumber).toMatch(/^\d{10}$/);

    const read = await http().get(created.headers.location).expect(200);
    expect(read.body).toEqual(created.body);

    // The client did not receive the answer and sends the same request again
    const repeated = await http()
      .post('/sales-orders')
      .send(request)
      .expect(200);
    expect(repeated.body).toEqual(created.body);
    expect(await prisma.salesOrder.count()).toBe(1);
  });
});
