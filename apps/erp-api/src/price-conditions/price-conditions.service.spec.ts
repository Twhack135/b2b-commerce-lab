import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePriceConditionDto } from './dto/create-price-condition.dto';
import { PriceConditionsService } from './price-conditions.service';

const date = (text: string) => new Date(`${text}T00:00:00.000Z`);

const CUSTOMERS = [
  { customerNumber: 'CUST-1000', name: 'Müller Heiztechnik', isActive: true },
  { customerNumber: 'OLD', name: 'Inactive Customer', isActive: false },
];

const UNITS = [
  { unitId: 'UNIT-S', name: 'Stuttgart', isActive: true, soldTo: 'CUST-1000' },
  { unitId: 'UNIT-OFF', name: 'Closed', isActive: false, soldTo: 'CUST-1000' },
  { unitId: 'UNIT-OLD', name: 'Old Sold-to', isActive: true, soldTo: 'OLD' },
];

const customer = (n: string) => CUSTOMERS.find((c) => c.customerNumber === n);

function unitRecord(unitId: string) {
  const u = UNITS.find((x) => x.unitId === unitId);
  if (!u) return null;
  return {
    unitId: u.unitId,
    name: u.name,
    isActive: u.isActive,
    soldToCustomerNumber: u.soldTo,
    soldTo: { customer: customer(u.soldTo) },
  };
}

/** A stored condition row (without includes) */
function row(changes: Record<string, unknown> = {}) {
  return {
    conditionId: 7,
    materialNumber: 'MAT-001',
    scope: 'SOLD_TO',
    soldToCustomerNumber: 'CUST-1000',
    unitId: null,
    amount: new Prisma.Decimal('4200.5'),
    currency: 'EUR',
    validFrom: date('2026-01-01'),
    validTo: date('2026-12-31'),
    isActive: true,
    ...changes,
  };
}

/** A condition as loaded with all includes */
function fullRecord(changes: Record<string, unknown> = {}) {
  const r = row(changes);
  return {
    ...r,
    material: { materialNumber: r.materialNumber, description: 'Heat Pump' },
    soldTo: r.soldToCustomerNumber ? customer(r.soldToCustomerNumber) : null,
    unit: r.unitId ? unitRecord(r.unitId as string) : null,
  };
}

// A plain object (not a class instance), so it can be copied with spread
const soldToCreate = {
  materialNumber: 'MAT-001',
  scope: 'SOLD_TO',
  soldToCustomerNumber: 'CUST-1000',
  amount: '4200.50',
  currency: 'EUR',
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
} satisfies CreatePriceConditionDto;

const unitCreate = {
  materialNumber: 'MAT-001',
  scope: 'B2B_UNIT',
  unitId: 'UNIT-S',
  amount: '4100.00',
  currency: 'EUR',
  validFrom: '2026-01-01',
} satisfies CreatePriceConditionDto;

function prismaError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('database error', {
    code,
    clientVersion: '7.10.1',
    meta,
  });
}

describe('PriceConditionsService', () => {
  let service: PriceConditionsService;

  const db = {
    $transaction: jest.fn(),
    // Row lock: SELECT currency FROM materials ... FOR UPDATE
    $queryRaw: jest.fn(),
    customer: { findUnique: jest.fn() },
    b2bUnit: { findUnique: jest.fn() },
    priceCondition: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    db.$transaction.mockImplementation((callback: (tx: typeof db) => unknown) =>
      callback(db),
    );
    db.$queryRaw.mockResolvedValue([{ currency: 'EUR' }]);
    db.customer.findUnique.mockImplementation(
      ({ where }: { where: { customerNumber: string } }) =>
        customer(where.customerNumber) ?? null,
    );
    db.b2bUnit.findUnique.mockImplementation(
      ({ where }: { where: { unitId: string } }) => unitRecord(where.unitId),
    );
    db.priceCondition.findFirst.mockResolvedValue(null);
    db.priceCondition.create.mockResolvedValue(row());
    db.priceCondition.findUnique.mockResolvedValue(fullRecord());
    db.priceCondition.findUniqueOrThrow.mockResolvedValue(row());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceConditionsService,
        { provide: PrismaService, useValue: db },
      ],
    }).compile();
    service = module.get(PriceConditionsService);
  });

  const expectNoWrites = () => {
    expect(db.priceCondition.create).not.toHaveBeenCalled();
    expect(db.priceCondition.update).not.toHaveBeenCalled();
  };

  const expect422 = async (promise: Promise<unknown>, messages: string[]) => {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject(
      { statusCode: 422, message: messages },
    );
  };

  describe('findAll and findOne', () => {
    it('should map a Sold-to condition with amount as text and plain dates', async () => {
      db.priceCondition.findMany.mockResolvedValue([fullRecord()]);

      await expect(service.findAll()).resolves.toEqual([
        {
          conditionId: 7,
          materialNumber: 'MAT-001',
          materialDescription: 'Heat Pump',
          scope: 'SOLD_TO',
          soldTo: CUSTOMERS[0],
          unit: null,
          amount: '4200.50',
          currency: 'EUR',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          isActive: true,
        },
      ]);
    });

    it('should map a unit condition with the unit and its Sold-to', async () => {
      db.priceCondition.findUnique.mockResolvedValue(
        fullRecord({
          scope: 'B2B_UNIT',
          soldToCustomerNumber: null,
          unitId: 'UNIT-OLD',
          validTo: null,
        }),
      );

      const condition = await service.findOne(7);

      expect(condition.soldTo).toBeNull();
      expect(condition.unit).toEqual({
        unitId: 'UNIT-OLD',
        name: 'Old Sold-to',
        isActive: true,
        soldTo: CUSTOMERS[1],
      });
      expect(condition.validTo).toBeNull();
    });

    it('should throw NotFoundException for an unknown condition', async () => {
      db.priceCondition.findUnique.mockResolvedValue(null);

      await expect(service.findOne(404)).rejects.toThrow(
        new NotFoundException('Price condition 404 not found'),
      );
    });

    it.each([0, -1, 2_147_483_648])(
      'should answer 404 for the impossible ID %d without a query',
      async (conditionId) => {
        await expect(service.findOne(conditionId)).rejects.toThrow(
          NotFoundException,
        );
        expect(db.priceCondition.findUnique).not.toHaveBeenCalled();
      },
    );
  });

  describe('create', () => {
    it('should lock the material and create a Sold-to condition', async () => {
      const condition = await service.create(soldToCreate);

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(db.priceCondition.create).toHaveBeenCalledWith({
        data: {
          materialNumber: 'MAT-001',
          scope: 'SOLD_TO',
          soldToCustomerNumber: 'CUST-1000',
          unitId: null,
          amount: '4200.50',
          currency: 'EUR',
          validFrom: date('2026-01-01'),
          validTo: date('2026-12-31'),
          isActive: true,
        },
      });
      expect(condition.conditionId).toBe(7);
    });

    it('should create an open-ended unit condition', async () => {
      await service.create(unitCreate);

      expect(db.priceCondition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          scope: 'B2B_UNIT',
          soldToCustomerNumber: null,
          unitId: 'UNIT-S',
          validTo: null,
        }) as unknown,
      });
    });

    it('should check overlaps against active conditions with the same key', async () => {
      await service.create(soldToCreate);

      expect(db.priceCondition.findFirst).toHaveBeenCalledWith({
        where: {
          materialNumber: 'MAT-001',
          scope: 'SOLD_TO',
          soldToCustomerNumber: 'CUST-1000',
          unitId: null,
          isActive: true,
          conditionId: undefined,
          validFrom: { lte: date('2026-12-31') },
          OR: [{ validTo: null }, { validTo: { gte: date('2026-01-01') } }],
        },
        orderBy: { validFrom: 'asc' },
      });
    });

    it('should not limit the start for an open-ended period', async () => {
      await service.create(unitCreate);

      const [{ where }] = db.priceCondition.findFirst.mock.calls[0] as [
        { where: { validFrom: unknown } },
      ];
      expect(where.validFrom).toBeUndefined();
    });

    it('should answer 409 with the conflicting condition', async () => {
      db.priceCondition.findFirst.mockResolvedValue(
        row({ conditionId: 3, validFrom: date('2026-06-01'), validTo: null }),
      );

      const error = await service.create(soldToCreate).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message:
          'The validity period overlaps with active price condition 3 (2026-06-01 to open-ended)',
        conflictingConditionId: 3,
      });
      expectNoWrites();
    });

    it('should not check overlaps for an inactive condition', async () => {
      await service.create({ ...soldToCreate, isActive: false });

      expect(db.priceCondition.findFirst).not.toHaveBeenCalled();
      expect(db.priceCondition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isActive: false }) as unknown,
      });
    });

    it.each([
      [
        'an unknown material',
        { materialNumber: 'NOPE' },
        ['materialNumber NOPE does not exist'],
      ],
      [
        'another currency than the material',
        { currency: 'USD' },
        ['currency must be EUR, the currency of material MAT-001'],
      ],
      [
        'an unknown Sold-to',
        { soldToCustomerNumber: 'NOPE' },
        ['soldToCustomerNumber NOPE does not exist'],
      ],
      [
        'an inactive Sold-to',
        { soldToCustomerNumber: 'OLD' },
        ['soldToCustomerNumber OLD is inactive'],
      ],
      [
        'an end before the start',
        { validFrom: '2026-12-31', validTo: '2026-01-01' },
        ['validTo must not be before validFrom'],
      ],
    ])('should answer 422 for %s', async (_case, change, messages) => {
      // The lock finds no row for a material that does not exist
      if ('materialNumber' in change) db.$queryRaw.mockResolvedValue([]);

      await expect422(service.create({ ...soldToCreate, ...change }), messages);
      expectNoWrites();
    });

    it.each([
      ['an unknown unit', 'NOPE', ['unitId NOPE does not exist']],
      ['an inactive unit', 'UNIT-OFF', ['unitId UNIT-OFF is inactive']],
      [
        'a unit with an inactive Sold-to',
        'UNIT-OLD',
        ['unitId UNIT-OLD has an inactive Sold-to OLD'],
      ],
    ])('should answer 422 for %s', async (_case, unitId, messages) => {
      await expect422(service.create({ ...unitCreate, unitId }), messages);
      expectNoWrites();
    });

    it('should report all problems at once', async () => {
      await expect422(
        service.create({
          ...soldToCreate,
          currency: 'USD',
          soldToCustomerNumber: 'OLD',
          validFrom: '2027-01-01',
        }),
        [
          'currency must be EUR, the currency of material MAT-001',
          'soldToCustomerNumber OLD is inactive',
          'validTo must not be before validFrom',
        ],
      );
    });

    it('should map an exclusion constraint violation to 409', async () => {
      db.priceCondition.create.mockRejectedValue(
        prismaError('P2039', {
          driverAdapterError: { cause: { originalCode: '23P01' } },
        }),
      );

      await expect(service.create(soldToCreate)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should pass on other database errors unchanged', async () => {
      const error = prismaError('P2039', {
        driverAdapterError: { cause: { originalCode: '23514' } },
      });
      db.priceCondition.create.mockRejectedValue(error);

      await expect(service.create(soldToCreate)).rejects.toBe(error);
    });
  });

  describe('update', () => {
    it('should change the amount after locking the material', async () => {
      await service.update(7, { amount: '3999.99' });

      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(db.priceCondition.update).toHaveBeenCalledWith({
        where: { conditionId: 7 },
        data: {
          amount: '3999.99',
          validFrom: undefined,
          validTo: undefined,
          isActive: undefined,
        },
      });
    });

    it('should make the condition open-ended with validTo null', async () => {
      await service.update(7, { validTo: null });

      expect(db.priceCondition.update).toHaveBeenCalledWith({
        where: { conditionId: 7 },
        data: expect.objectContaining({ validTo: null }) as unknown,
      });
    });

    it('should exclude the condition itself from the overlap check', async () => {
      await service.update(7, { validFrom: '2026-02-01' });

      expect(db.priceCondition.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          conditionId: { not: 7 },
          validFrom: { lte: date('2026-12-31') },
          OR: [{ validTo: null }, { validTo: { gte: date('2026-02-01') } }],
        }) as unknown,
        orderBy: { validFrom: 'asc' },
      });
    });

    it('should check the new period together with the stored end', async () => {
      await expect422(service.update(7, { validFrom: '2027-01-01' }), [
        'validTo must not be before validFrom',
      ]);
      expectNoWrites();
    });

    it('should answer 409 when a changed period overlaps', async () => {
      db.priceCondition.findFirst.mockResolvedValue(
        row({ conditionId: 8, validFrom: date('2027-01-01'), validTo: null }),
      );

      await expect(service.update(7, { validTo: null })).rejects.toThrow(
        ConflictException,
      );
      expectNoWrites();
    });

    it('should keep an active condition whose unit became inactive', async () => {
      db.priceCondition.findUniqueOrThrow.mockResolvedValue(
        row({
          scope: 'B2B_UNIT',
          soldToCustomerNumber: null,
          unitId: 'UNIT-OFF',
        }),
      );

      await service.update(7, { amount: '1.00' });

      expect(db.b2bUnit.findUnique).not.toHaveBeenCalled();
      expect(db.priceCondition.update).toHaveBeenCalled();
    });

    it('should deactivate without checking overlaps', async () => {
      await service.update(7, { isActive: false });

      expect(db.priceCondition.findFirst).not.toHaveBeenCalled();
      expect(db.priceCondition.update).toHaveBeenCalled();
    });

    describe('reactivation', () => {
      const inactiveUnitCondition = (unitId: string) =>
        row({
          scope: 'B2B_UNIT',
          soldToCustomerNumber: null,
          unitId,
          isActive: false,
        });

      it('should reactivate a valid condition', async () => {
        db.priceCondition.findUniqueOrThrow.mockResolvedValue(
          inactiveUnitCondition('UNIT-S'),
        );

        await service.update(7, { isActive: true });

        expect(db.priceCondition.findFirst).toHaveBeenCalled();
        expect(db.priceCondition.update).toHaveBeenCalled();
      });

      it.each([
        ['an inactive unit', 'UNIT-OFF', ['unitId UNIT-OFF is inactive']],
        [
          'a unit with an inactive Sold-to',
          'UNIT-OLD',
          ['unitId UNIT-OLD has an inactive Sold-to OLD'],
        ],
      ])('should reject %s', async (_case, unitId, messages) => {
        db.priceCondition.findUniqueOrThrow.mockResolvedValue(
          inactiveUnitCondition(unitId),
        );

        await expect422(service.update(7, { isActive: true }), messages);
        expectNoWrites();
      });

      it('should reject an inactive Sold-to', async () => {
        db.priceCondition.findUniqueOrThrow.mockResolvedValue(
          row({ soldToCustomerNumber: 'OLD', isActive: false }),
        );

        await expect422(service.update(7, { isActive: true }), [
          'soldToCustomerNumber OLD is inactive',
        ]);
      });

      it('should reject a condition whose material changed its currency', async () => {
        db.priceCondition.findUniqueOrThrow.mockResolvedValue(
          row({ isActive: false }),
        );
        db.$queryRaw.mockResolvedValue([{ currency: 'CHF' }]);

        await expect422(service.update(7, { isActive: true }), [
          'currency must be CHF, the currency of material MAT-001',
        ]);
      });

      it('should answer 409 when the reactivated period overlaps', async () => {
        db.priceCondition.findUniqueOrThrow.mockResolvedValue(
          row({ isActive: false }),
        );
        db.priceCondition.findFirst.mockResolvedValue(row({ conditionId: 9 }));

        await expect(service.update(7, { isActive: true })).rejects.toThrow(
          ConflictException,
        );
        expectNoWrites();
      });
    });

    it('should throw NotFoundException for an unknown condition', async () => {
      db.priceCondition.findUnique.mockResolvedValue(null);

      await expect(service.update(404, { amount: '1.00' })).rejects.toThrow(
        new NotFoundException('Price condition 404 not found'),
      );
      expect(db.$queryRaw).not.toHaveBeenCalled();
      expectNoWrites();
    });
  });
});
