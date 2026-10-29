import { spawnSync } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, resetDatabase } from './helpers';

describe('Seed', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const runSeed = () =>
    spawnSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'db', 'seed'],
      { env: process.env, encoding: 'utf8' },
    );

  it('can run twice without duplicates and creates valid units', async () => {
    expect(runSeed().status).toBe(0);
    expect(runSeed().status).toBe(0);

    await expect(prisma.material.count()).resolves.toBe(2);
    await expect(prisma.customer.count()).resolves.toBe(5);
    await expect(prisma.customerAccountMember.count()).resolves.toBe(3);
    await expect(prisma.b2bUnit.count()).resolves.toBe(2);
    await expect(prisma.priceCondition.count()).resolves.toBe(3);

    const defaults = await prisma.b2bUnitShipTo.groupBy({
      by: ['unitId'],
      where: { isDefault: true },
      _count: true,
    });
    expect(defaults).toEqual([
      { unitId: 'NW-BREMEN', _count: 1 },
      { unitId: 'NW-HAMBURG', _count: 1 },
    ]);
  });
});
