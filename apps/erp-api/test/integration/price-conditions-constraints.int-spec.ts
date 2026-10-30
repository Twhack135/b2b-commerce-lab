// Database rules of price_conditions, checked directly with SQL (without the
// service), so they protect the data even if the API checks are bypassed.
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createPricingData,
  createTestApp,
  LIST_PRICE_ID,
  resetDatabase,
} from './helpers';

type Row = {
  type?: string;
  org?: string;
  material?: string;
  scope?: string;
  soldTo?: string | null;
  unit?: string | null;
  amount?: string;
  currency?: string;
  from?: string;
  to?: string | null;
  active?: boolean;
};

describe('price_conditions database rules', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createPricingData(prisma);
  });

  /**
   * Inserts one row with SQL; defaults: active ZP02 Sold-to condition for
   * ACC in sales area 1000/10/00 (EUR)
   */
  const insert = (row: Row = {}) => {
    const r = {
      type: 'ZP02',
      org: '1000',
      material: 'MAT-1',
      scope: 'SOLD_TO',
      soldTo: 'ACC',
      unit: null,
      amount: '100.00',
      currency: 'EUR',
      from: '2026-01-01',
      to: '2026-12-31',
      active: true,
      ...row,
    };
    return prisma.$executeRaw`
      INSERT INTO price_conditions (condition_type_code, sales_organization,
        distribution_channel, division, material_number, scope, sold_to_customer_number,
        unit_id, amount, currency, valid_from, valid_to, is_active, updated_at)
      VALUES (${r.type}, ${r.org}, '10', '00', ${r.material}, ${r.scope}::price_condition_scope,
        ${r.soldTo}, ${r.unit}, ${r.amount}::numeric, ${r.currency}, ${r.from}::date,
        ${r.to}::date, ${r.active}, now())`;
  };

  /** A list price (ZP01) of the sales area, without key */
  const listRow = (row: Row = {}): Row => ({
    type: 'ZP01',
    scope: 'SALES_AREA',
    soldTo: null,
    unit: null,
    ...row,
  });

  const unitRow = (row: Row = {}): Row => ({
    scope: 'B2B_UNIT',
    soldTo: null,
    unit: 'U1',
    ...row,
  });

  /** The PostgreSQL error code of a failed statement */
  const codeOf = async (statement: Promise<unknown>) => {
    const error = await statement.then(
      () => null,
      (e: unknown) => e,
    );
    const meta = (error as { meta?: { driverAdapterError?: unknown } } | null)
      ?.meta?.driverAdapterError as
      { cause?: { originalCode?: string } } | undefined;
    return error === null
      ? 'ok'
      : (meta?.cause?.originalCode ?? (error as Error).message);
  };

  it('has the btree_gist extension installed', async () => {
    const rows = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`;
    expect(rows).toHaveLength(1);
  });

  describe('exclusion constraints (no overlapping active periods)', () => {
    it.each([
      ['the same period', '2026-01-01', '2026-12-31'],
      ['a period inside', '2026-03-01', '2026-03-31'],
      ['a period starting on the last day', '2026-12-31', '2027-06-30'],
      ['a period ending on the first day', '2025-06-01', '2026-01-01'],
      ['an open-ended period starting inside', '2026-06-01', null],
      ['a period covering everything', '2020-01-01', null],
    ])('rejects %s for the same Sold-to', async (_case, from, to) => {
      await insert();
      await expect(codeOf(insert({ from, to }))).resolves.toBe('23P01');
    });

    it('rejects overlapping periods for the same unit', async () => {
      await insert(unitRow({ to: null }));
      await expect(
        codeOf(insert(unitRow({ from: '2030-01-01', to: null }))),
      ).resolves.toBe('23P01');
    });

    it('rejects two open-ended conditions for the same key', async () => {
      await insert({ to: null });
      await expect(
        codeOf(insert({ from: '2027-01-01', to: null })),
      ).resolves.toBe('23P01');
    });

    it.each([
      ['a directly following period', { from: '2027-01-01', to: null }],
      ['a directly preceding period', { from: '2025-01-01', to: '2025-12-31' }],
      ['another material', { material: 'MAT-2' }],
      ['another Sold-to', { soldTo: 'M1' }],
      ['an inactive duplicate', { active: false }],
      ['a unit condition for the same material and period', unitRow()],
    ])('allows %s', async (_case, row) => {
      await insert();
      await expect(codeOf(insert(row))).resolves.toBe('ok');
    });

    // The test data has the open-ended German list price 9001 for MAT-1
    it('rejects an overlapping list price of the same sales area and material', async () => {
      await expect(
        codeOf(insert(listRow({ from: '2030-01-01', to: null }))),
      ).resolves.toBe('23P01');
    });

    it.each([
      ['another sales area', listRow({ org: '2000', currency: 'PLN' })],
      ['another material', listRow({ material: 'MAT-2' })],
      ['an inactive duplicate', listRow({ active: false })],
    ])('allows a list price for %s', async (_case, row) => {
      await expect(codeOf(insert(row))).resolves.toBe('ok');
    });

    it('rejects reactivating an overlapping inactive condition', async () => {
      await insert();
      await insert({ active: false, amount: '90.00' });

      await expect(
        codeOf(prisma.$executeRaw`
          UPDATE price_conditions SET is_active = true WHERE amount = 90`),
      ).resolves.toBe('23P01');
    });
  });

  describe('check constraints', () => {
    it.each([
      ['a Sold-to condition without Sold-to', { soldTo: null }],
      ['a Sold-to condition with a unit', { unit: 'U1' }],
      ['a unit condition without unit', unitRow({ unit: null })],
      ['a unit condition with a Sold-to', unitRow({ soldTo: 'ACC' })],
      [
        'a list price with a Sold-to',
        listRow({ soldTo: 'ACC', org: '2000', currency: 'PLN' }),
      ],
      [
        'a list price with a unit',
        listRow({ unit: 'U1', org: '2000', currency: 'PLN' }),
      ],
      ['an amount of zero', { amount: '0' }],
      ['a negative amount', { amount: '-5.00' }],
      ['an end before the start', { from: '2026-12-31', to: '2026-01-01' }],
      ['a lowercase currency', { currency: 'eur' }],
    ])('rejects %s', async (_case, row) => {
      await expect(codeOf(insert(row))).resolves.toBe('23514');
    });

    it('allows a one-day period', async () => {
      await expect(
        codeOf(insert({ from: '2026-05-05', to: '2026-05-05' })),
      ).resolves.toBe('ok');
    });
  });

  describe('foreign keys', () => {
    it.each([
      ['an unknown material', { material: 'NOPE' }],
      ['an unknown Sold-to', { soldTo: 'NOPE' }],
      ['an unknown unit', unitRow({ unit: 'NOPE' })],
      // Sprint 9C-B: market consistency
      ['a sales area that is not configured', listRow({ org: '9999' })],
      [
        'a Sold-to that is not assigned to the sales area',
        { org: '2000', currency: 'PLN' },
      ],
      [
        'a unit of another sales area',
        unitRow({ org: '2000', currency: 'PLN' }),
      ],
      [
        'another currency than the sales organization',
        listRow({ org: '2000' }),
      ],
      ['EUR prices in Japan', listRow({ org: '3000' })],
      ['an unknown currency', listRow({ org: '2000', currency: 'XXX' })],
      // Condition type and scope must be configured together
      ['ZP01 for a Sold-to', { type: 'ZP01' }],
      [
        'ZP02 as list price',
        listRow({ type: 'ZP02', org: '2000', currency: 'PLN' }),
      ],
      ['a discount type', { type: 'ZD01' }],
    ])('rejects %s', async (_case, row) => {
      await expect(codeOf(insert(row))).resolves.toBe('23503');
    });

    it('keeps a sales organization from changing its currency while conditions use it', async () => {
      await expect(
        codeOf(
          prisma.$executeRaw`UPDATE sales_organizations SET currency_code = 'PLN' WHERE code = '1000'`,
        ),
      ).resolves.toBe('23001');
    });

    // ON DELETE RESTRICT is reported as restrict_violation (23001)
    it('prevents deleting a material, customer or unit that has conditions', async () => {
      // LONE has no account, so only its price condition refers to it
      await insert({ soldTo: 'LONE' });
      await insert(unitRow());
      await prisma.$executeRaw`DELETE FROM b2b_unit_ship_tos WHERE unit_id = 'U1'`;

      await expect(
        codeOf(
          prisma.$executeRaw`DELETE FROM materials WHERE material_number = 'MAT-1'`,
        ),
      ).resolves.toBe('23001');
      await expect(
        codeOf(
          prisma.$executeRaw`DELETE FROM customers WHERE customer_number = 'LONE'`,
        ),
      ).resolves.toBe('23001');
      await expect(
        codeOf(prisma.$executeRaw`DELETE FROM b2b_units WHERE unit_id = 'U1'`),
      ).resolves.toBe('23001');
      await expect(
        prisma.priceCondition.count({
          where: { conditionId: { lt: LIST_PRICE_ID } },
        }),
      ).resolves.toBe(2);
    });
  });
});
