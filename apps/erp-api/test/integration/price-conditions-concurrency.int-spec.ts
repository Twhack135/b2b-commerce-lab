// Concurrent writes of price conditions must never store overlapping active
// periods (per sales area, material and key) and never answer with HTTP 500. Every scenario is repeated
// several times, because timing differs per run.
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createPricingData,
  createTestApp,
  GERMANY,
  POLAND,
  resetDatabase,
} from './helpers';

const ROUNDS = 10;
const PARALLEL = 5;

const soldToBody = {
  conditionTypeCode: 'ZP02',
  ...GERMANY,
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

  // Since Sprint 9C-B list prices are condition records as well
  const listPrice = (salesArea: typeof GERMANY, validFrom: string) => ({
    conditionTypeCode: 'ZP01',
    ...salesArea,
    materialNumber: 'MAT-1',
    scope: 'SALES_AREA',
    amount: salesArea === GERMANY ? '4600.00' : '19999.00',
    validFrom,
  });

  it('creates exactly one of several overlapping list prices of a sales area', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await prisma.priceCondition.deleteMany();

      const responses = await Promise.all(
        Array.from({ length: PARALLEL }, (_, i) =>
          http()
            .post('/price-conditions')
            .send(listPrice(GERMANY, `2026-0${i + 1}-01`)),
        ),
      );

      expect(statuses(responses)).toEqual([201, 409, 409, 409, 409]);
      await expect(
        prisma.priceCondition.count({ where: { scope: 'SALES_AREA' } }),
      ).resolves.toBe(1);
    }
  });

  it('creates list prices of different sales areas in parallel', async () => {
    await prisma.priceCondition.deleteMany();

    const responses = await Promise.all([
      http().post('/price-conditions').send(listPrice(GERMANY, '2026-01-01')),
      http().post('/price-conditions').send(listPrice(POLAND, '2026-01-01')),
    ]);

    expect(statuses(responses)).toEqual([201, 201]);
    const stored = await prisma.priceCondition.findMany({
      orderBy: { salesOrganization: 'asc' },
    });
    expect(stored.map((c) => `${c.salesOrganization}:${c.currency}`)).toEqual([
      '1000:EUR',
      '2000:PLN',
    ]);
  });
});
