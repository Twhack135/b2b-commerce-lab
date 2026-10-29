// Concurrent writes of price conditions must never store overlapping active
// periods, never store an active condition in another currency than its
// material and never answer with HTTP 500. Every scenario is repeated
// several times, because timing differs per run.
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createPricingData, createTestApp, resetDatabase } from './helpers';

const ROUNDS = 10;
const PARALLEL = 5;

const soldToBody = {
  conditionTypeCode: 'ZP02',
  materialNumber: 'MAT-1',
  scope: 'SOLD_TO',
  soldToCustomerNumber: 'ACC',
  amount: '4350.00',
  currency: 'EUR',
};

describe('Concurrent price condition writes (material row lock)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createPricingData(prisma);
  });

  const statuses = (responses: { status: number }[]) =>
    responses.map((r) => r.status).sort((a, b) => a - b);

  it('creates exactly one of several overlapping conditions', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await prisma.priceCondition.deleteMany();

      // Different, but overlapping periods
      const responses = await Promise.all(
        Array.from({ length: PARALLEL }, (_, i) =>
          http()
            .post('/price-conditions')
            .send({
              ...soldToBody,
              validFrom: `2026-0${i + 1}-01`,
              validTo: null,
            }),
        ),
      );

      expect(statuses(responses)).toEqual([201, 409, 409, 409, 409]);
      await expect(prisma.priceCondition.count()).resolves.toBe(1);
    }
  });

  it('creates conditions for different keys in parallel', async () => {
    const responses = await Promise.all([
      http()
        .post('/price-conditions')
        .send({ ...soldToBody, validFrom: '2026-01-01' }),
      http()
        .post('/price-conditions')
        .send({
          ...soldToBody,
          soldToCustomerNumber: 'M1',
          validFrom: '2026-01-01',
        }),
      http()
        .post('/price-conditions')
        .send({
          ...soldToBody,
          scope: 'B2B_UNIT',
          soldToCustomerNumber: undefined,
          unitId: 'U1',
          validFrom: '2026-01-01',
        }),
      http()
        .post('/price-conditions')
        .send({
          ...soldToBody,
          materialNumber: 'MAT-2',
          currency: 'CHF',
          validFrom: '2026-01-01',
        }),
    ]);

    expect(statuses(responses)).toEqual([201, 201, 201, 201]);
  });

  it('reactivates at most one of several overlapping conditions', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await prisma.priceCondition.deleteMany();
      const ids: number[] = [];
      for (let i = 0; i < PARALLEL; i++) {
        const { body } = await http()
          .post('/price-conditions')
          .send({ ...soldToBody, validFrom: '2026-01-01', isActive: false })
          .expect(201);
        ids.push((body as { conditionId: number }).conditionId);
      }

      const responses = await Promise.all(
        ids.map((id) =>
          http().patch(`/price-conditions/${id}`).send({ isActive: true }),
        ),
      );

      expect(statuses(responses)).toEqual([200, 409, 409, 409, 409]);
      await expect(
        prisma.priceCondition.count({ where: { isActive: true } }),
      ).resolves.toBe(1);
    }
  });

  it('never stores an active condition in another currency than the material', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await prisma.priceCondition.deleteMany();
      await prisma.material.update({
        where: { materialNumber: 'MAT-1' },
        data: { currency: 'EUR' },
      });

      const [conditionResponse, materialResponse] = await Promise.all([
        http()
          .post('/price-conditions')
          .send({ ...soldToBody, validFrom: '2026-01-01' }),
        http().patch('/materials/MAT-1').send({ currency: 'CHF' }),
      ]);

      // Whichever request got the lock first wins; the other one sees its result
      expect([
        [conditionResponse.status, materialResponse.status].join(' '),
      ]).toEqual([expect.stringMatching(/^(201 422|422 200)$/) as unknown]);

      const material = await prisma.material.findUniqueOrThrow({
        where: { materialNumber: 'MAT-1' },
      });
      await expect(
        prisma.priceCondition.count({
          where: { isActive: true, currency: { not: material.currency } },
        }),
      ).resolves.toBe(0);
    }
  });
});
