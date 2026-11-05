import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PricingProceduresService } from '../../src/pricing-procedures/pricing-procedures.service';
import { createTestApp, GERMANY, JAPAN, POLAND } from './helpers';

// Sprint 13A-1: the pricing configuration of migration
// 20261105120000_add_pricing_procedures and its read-only admin API. These
// tables are configuration (like condition types): the tests never change
// them; every constraint test below fails on purpose and stores nothing.

describe('Pricing procedures (Sprint 13A)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];
  let service: PricingProceduresService;

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
    service = app.get(PricingProceduresService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('configuration of the migration', () => {
    it('has the base price access sequence ZBP1 in the approved order', async () => {
      const accesses = await prisma.accessSequenceAccess.findMany({
        where: { accessSequenceCode: 'ZBP1' },
        orderBy: { accessNumber: 'asc' },
      });
      expect(
        accesses.map((a) => [a.accessNumber, a.conditionTypeCode, a.scope]),
      ).toEqual([
        [10, 'ZP03', 'B2B_UNIT'],
        [20, 'ZP02', 'B2B_UNIT'],
        [30, 'ZP03', 'SOLD_TO'],
        [40, 'ZP02', 'SOLD_TO'],
        [50, 'ZP01', 'SALES_AREA'],
      ]);
      expect(accesses.every((a) => a.materialSpecific)).toBe(true);
    });

    it('determines one procedure per market, for every customer', async () => {
      for (const [area, code] of [
        [GERMANY, 'ZDE001'],
        [POLAND, 'ZPL001'],
        [JAPAN, 'ZJP001'],
      ] as const) {
        const procedure = await service.determine(area);
        expect(procedure?.code).toBe(code);
        expect(procedure?.revision).toBe(1);
        // A customer-specific key falls back to the general determination
        expect((await service.determine(area, 'X'))?.code).toBe(code);
      }
      expect(
        await service.determine({
          salesOrganization: '9999',
          distributionChannel: '10',
          division: '00',
        }),
      ).toBeNull();
    });
  });

  describe('admin API (read-only)', () => {
    it('lists the procedures with their sales areas', async () => {
      const response = await http().get('/pricing-procedures').expect(200);
      expect(response.body).toEqual([
        {
          code: 'ZDE001',
          name: 'B2B Germany',
          revision: 1,
          isActive: true,
          assignments: [{ ...GERMANY, customerProcedure: '*' }],
          stepCount: 3,
        },
        {
          code: 'ZJP001',
          name: 'B2B Japan',
          revision: 1,
          isActive: true,
          assignments: [{ ...JAPAN, customerProcedure: '*' }],
          stepCount: 3,
        },
        {
          code: 'ZPL001',
          name: 'B2B Poland',
          revision: 1,
          isActive: true,
          assignments: [{ ...POLAND, customerProcedure: '*' }],
          stepCount: 3,
        },
      ]);
    });

    it('shows the steps with their access sequences and flags', async () => {
      const response = await http()
        .get('/pricing-procedures/ZDE001')
        .expect(200);
      const steps = response.body.steps as Record<string, unknown>[];
      expect(
        steps.map((s) => [
          s.stepNumber,
          s.kind,
          s.label,
          s.statistical,
          s.mandatory,
          s.subtotalKey,
          s.fromStep,
          s.toStep,
        ]),
      ).toEqual([
        [5, 'CONDITION', 'List price', true, false, null, null, null],
        [10, 'CONDITION', 'Base price', false, true, null, null, null],
        [100, 'SUBTOTAL', 'Net value', false, false, 'NET_VALUE', 10, 99],
      ]);
      expect(response.body.steps[1].accessSequence).toMatchObject({
        code: 'ZBP1',
        name: 'Base price',
        accesses: [
          {
            accessNumber: 10,
            scope: 'B2B_UNIT',
            conditionType: { code: 'ZP03', name: 'Special Price' },
          },
          {
            accessNumber: 20,
            scope: 'B2B_UNIT',
            conditionType: { code: 'ZP02' },
          },
          {
            accessNumber: 30,
            scope: 'SOLD_TO',
            conditionType: { code: 'ZP03' },
          },
          {
            accessNumber: 40,
            scope: 'SOLD_TO',
            conditionType: { code: 'ZP02' },
          },
          {
            accessNumber: 50,
            scope: 'SALES_AREA',
            conditionType: { code: 'ZP01' },
          },
        ],
      });
      expect(response.body.steps[2].accessSequence).toBeNull();
    });

    it('answers 404 for unknown procedures and offers no changes', async () => {
      await http().get('/pricing-procedures/NOPE').expect(404);
      await http().post('/pricing-procedures').send({}).expect(404);
      await http().patch('/pricing-procedures/ZDE001').send({}).expect(404);
    });
  });

  describe('the database refuses inconsistent configuration', () => {
    const step = (data: Record<string, unknown>) =>
      prisma.pricingProcedureStep.create({
        data: {
          procedureCode: 'ZDE001',
          stepNumber: 50,
          kind: 'CONDITION',
          label: 'Test',
          ...data,
        } as never,
      });

    it('only accepts accesses to combinations allowed for condition records', async () => {
      // ZP01 is a list price: never on the level of a B2B unit
      await expect(
        prisma.accessSequenceAccess.create({
          data: {
            accessSequenceCode: 'ZLP1',
            accessNumber: 20,
            conditionTypeCode: 'ZP01',
            scope: 'B2B_UNIT',
          },
        }),
      ).rejects.toThrow();
      // The same type and level twice in one sequence
      await expect(
        prisma.accessSequenceAccess.create({
          data: {
            accessSequenceCode: 'ZBP1',
            accessNumber: 60,
            conditionTypeCode: 'ZP03',
            scope: 'SOLD_TO',
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses steps that break the rules of their kind', async () => {
      // A condition step without access sequence
      await expect(step({})).rejects.toThrow();
      // A subtotal with an access sequence, without base, or statistical
      await expect(
        step({
          kind: 'SUBTOTAL',
          accessSequenceCode: 'ZBP1',
          subtotalKey: 'X',
          fromStep: 10,
        }),
      ).rejects.toThrow();
      await expect(
        step({ kind: 'SUBTOTAL', subtotalKey: 'X' }),
      ).rejects.toThrow();
      await expect(
        step({
          kind: 'SUBTOTAL',
          subtotalKey: 'X',
          fromStep: 10,
          isStatistical: true,
        }),
      ).rejects.toThrow();
      // A base that is not before the step, or reversed
      await expect(
        step({ kind: 'SUBTOTAL', subtotalKey: 'X', fromStep: 10, toStep: 50 }),
      ).rejects.toThrow();
      await expect(
        step({ kind: 'SUBTOTAL', subtotalKey: 'X', fromStep: 20, toStep: 10 }),
      ).rejects.toThrow();
      // The same subtotal twice in one procedure
      await expect(
        step({ kind: 'SUBTOTAL', subtotalKey: 'NET_VALUE', fromStep: 10 }),
      ).rejects.toThrow();
      expect(await prisma.pricingProcedureStep.count()).toBe(9);
    });

    it('refuses determinations of unknown sales areas or with invalid keys', async () => {
      await expect(
        prisma.pricingProcedureDetermination.create({
          data: {
            salesOrganization: '9999',
            distributionChannel: '10',
            division: '00',
            procedureCode: 'ZDE001',
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.pricingProcedureDetermination.create({
          data: { ...GERMANY, customerProcedure: '?', procedureCode: 'ZDE001' },
        }),
      ).rejects.toThrow();
      // One procedure per sales area and customer procedure
      await expect(
        prisma.pricingProcedureDetermination.create({
          data: { ...GERMANY, procedureCode: 'ZPL001' },
        }),
      ).rejects.toThrow();
      expect(await prisma.pricingProcedureDetermination.count()).toBe(3);
    });
  });
});
