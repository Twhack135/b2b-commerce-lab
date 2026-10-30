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

const GERMANY = {
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
};
const POLAND = { ...GERMANY, salesOrganization: '2000' };
const JAPAN = { ...GERMANY, salesOrganization: '3000' };
const area = (key: typeof GERMANY) =>
  `${key.salesOrganization}/${key.distributionChannel}/${key.division}`;

// Configured like the migration; 9000 belongs to an inactive organization
const SALES_AREAS = [
  { key: GERMANY, currency: { code: 'EUR', decimals: 2 }, isActive: true },
  { key: POLAND, currency: { code: 'PLN', decimals: 2 }, isActive: true },
  { key: JAPAN, currency: { code: 'JPY', decimals: 0 }, isActive: true },
  {
    key: { ...GERMANY, salesOrganization: '9000' },
    currency: { code: 'EUR', decimals: 2 },
    isActive: false,
  },
];
const currencyOf = (key: typeof GERMANY) =>
  SALES_AREAS.find((a) => area(a.key) === area(key))!.currency;

const CUSTOMERS = [
  { customerNumber: 'CUST-1000', name: 'Müller Heiztechnik', isActive: true },
  { customerNumber: 'OLD', name: 'Inactive Customer', isActive: false },
  { customerNumber: 'NOAREA', name: 'Not In Germany', isActive: true },
  { customerNumber: 'PAUSED', name: 'Paused In Germany', isActive: true },
];

/** Sales area assignments; NOAREA has none, PAUSED is inactive in Germany */
const ASSIGNMENTS: Record<string, { area: string; isActive: boolean }[]> = {
  'CUST-1000': [
    { area: '1000/10/00', isActive: true },
    { area: '3000/10/00', isActive: true },
  ],
  OLD: [{ area: '1000/10/00', isActive: true }],
  NOAREA: [],
  PAUSED: [{ area: '1000/10/00', isActive: false }],
};

const UNITS = [
  {
    unitId: 'UNIT-S',
    name: 'Stuttgart',
    isActive: true,
    soldTo: 'CUST-1000',
    salesArea: GERMANY,
  },
  {
    unitId: 'UNIT-OFF',
    name: 'Closed',
    isActive: false,
    soldTo: 'CUST-1000',
    salesArea: GERMANY,
  },
  {
    unitId: 'UNIT-OLD',
    name: 'Old Sold-to',
    isActive: true,
    soldTo: 'OLD',
    salesArea: GERMANY,
  },
  {
    unitId: 'UNIT-JP',
    name: 'Osaka',
    isActive: true,
    soldTo: 'CUST-1000',
    salesArea: JAPAN,
  },
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
    ...u.salesArea,
    soldTo: { customer: customer(u.soldTo) },
  };
}

/** As configured by the migration, plus an inactive type for the tests */
const CONDITION_TYPE_ROWS = [
  {
    code: 'ZP01',
    name: 'List Price',
    conditionClass: 'PRICE',
    calculationType: 'QUANTITY',
    isActive: true,
  },
  {
    code: 'ZP02',
    name: 'Customer Net Price',
    conditionClass: 'PRICE',
    calculationType: 'QUANTITY',
    isActive: true,
  },
  {
    code: 'ZP03',
    name: 'Special Price',
    conditionClass: 'PRICE',
    calculationType: 'QUANTITY',
    isActive: true,
  },
  {
    code: 'ZD01',
    name: 'Customer Discount',
    conditionClass: 'DISCOUNT_SURCHARGE',
    calculationType: 'PERCENTAGE',
    isActive: true,
  },
  {
    code: 'ZF01',
    name: 'Freight',
    conditionClass: 'FREIGHT',
    calculationType: 'FIXED_AMOUNT',
    isActive: true,
  },
  {
    code: 'ZT01',
    name: 'Output Tax',
    conditionClass: 'TAX',
    calculationType: 'PERCENTAGE',
    isActive: true,
  },
  {
    code: 'ZOLD',
    name: 'Retired Price',
    conditionClass: 'PRICE',
    calculationType: 'QUANTITY',
    isActive: false,
  },
];

// Configuration as in the migration: the not yet calculable types are not
// allowed for condition records; ZP01 only per sales area, ZP02 and ZP03
// only per Sold-to or unit
const NOT_ALLOWED = ['ZD01', 'ZF01', 'ZT01'];
const SCOPES: Record<string, string[]> = {
  ZP01: ['SALES_AREA'],
  ZP02: ['SOLD_TO', 'B2B_UNIT'],
  ZP03: ['SOLD_TO', 'B2B_UNIT'],
  ZOLD: ['SOLD_TO'],
};
const CONDITION_TYPES = CONDITION_TYPE_ROWS.map((t) => ({
  ...t,
  allowedForConditionRecords: !NOT_ALLOWED.includes(t.code),
  allowedScopes: (SCOPES[t.code] ?? []).map((scope) => ({ scope })),
}));

const ZP02 = {
  code: 'ZP02',
  name: 'Customer Net Price',
  conditionClass: 'PRICE',
  calculationType: 'QUANTITY',
};

/** A stored condition row (without includes) */
function row(changes: Record<string, unknown> = {}) {
  return {
    conditionId: 7,
    conditionTypeCode: 'ZP02',
    ...GERMANY,
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
    conditionType: CONDITION_TYPES.find((t) => t.code === r.conditionTypeCode),
    material: { materialNumber: r.materialNumber, description: 'Heat Pump' },
    soldTo: r.soldToCustomerNumber ? customer(r.soldToCustomerNumber) : null,
    unit: r.unitId ? unitRecord(r.unitId as string) : null,
    salesOrgCurrency: { currency: currencyOf(r as unknown as typeof GERMANY) },
  };
}

// A plain object (not a class instance), so it can be copied with spread
const soldToCreate = {
  conditionTypeCode: 'ZP02',
  ...GERMANY,
  materialNumber: 'MAT-001',
  scope: 'SOLD_TO',
  soldToCustomerNumber: 'CUST-1000',
  amount: '4200.50',
  currency: 'EUR',
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
} satisfies CreatePriceConditionDto;

const unitCreate = {
  conditionTypeCode: 'ZP02',
  ...GERMANY,
  materialNumber: 'MAT-001',
  scope: 'B2B_UNIT',
  unitId: 'UNIT-S',
  amount: '4100.00',
  currency: 'EUR',
  validFrom: '2026-01-01',
} satisfies CreatePriceConditionDto;

// List price of the sales area; the currency is optional (taken from it)
const listPriceCreate = {
  conditionTypeCode: 'ZP01',
  ...GERMANY,
  materialNumber: 'MAT-001',
  scope: 'SALES_AREA',
  amount: '4500.00',
  validFrom: '1900-01-01',
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
    // Row lock: SELECT material_number FROM materials ... FOR UPDATE
    $queryRaw: jest.fn(),
    customer: { findUnique: jest.fn() },
    b2bUnit: { findUnique: jest.fn() },
    conditionType: { findUnique: jest.fn() },
    salesArea: { findUnique: jest.fn() },
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
    db.$queryRaw.mockResolvedValue([{ material_number: 'MAT-001' }]);
    db.customer.findUnique.mockImplementation(
      ({
        where,
        include,
      }: {
        where: { customerNumber: string };
        include?: { salesAreas: { where: typeof GERMANY } };
      }) => {
        const c = customer(where.customerNumber);
        if (!c) return null;
        const wanted = include && area(include.salesAreas.where);
        return {
          ...c,
          salesAreas: (ASSIGNMENTS[c.customerNumber] ?? [])
            .filter((a) => a.area === wanted)
            .map((a) => ({ isActive: a.isActive })),
        };
      },
    );
    db.salesArea.findUnique.mockImplementation(
      ({
        where,
      }: {
        where: {
          salesOrganization_distributionChannel_division: typeof GERMANY;
        };
      }) => {
        const key = where.salesOrganization_distributionChannel_division;
        const a = SALES_AREAS.find((x) => area(x.key) === area(key));
        return a
          ? {
              ...a.key,
              isActive: true,
              organization: { isActive: a.isActive, currency: a.currency },
            }
          : null;
      },
    );
    db.b2bUnit.findUnique.mockImplementation(
      ({ where }: { where: { unitId: string } }) => unitRecord(where.unitId),
    );
    db.conditionType.findUnique.mockImplementation(
      ({ where }: { where: { code: string } }) =>
        CONDITION_TYPES.find((t) => t.code === where.code) ?? null,
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
          conditionType: ZP02,
          salesArea: GERMANY,
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
          conditionTypeCode: 'ZP02',
          ...GERMANY,
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
          ...GERMANY,
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
        'another currency than the sales area',
        { currency: 'PLN' },
        ['currency must be EUR, the currency of sales area 1000/10/00'],
      ],
      [
        'a Sold-to that is not assigned to the sales area',
        { soldToCustomerNumber: 'NOAREA' },
        [
          'soldToCustomerNumber NOAREA is not assigned to sales area 1000/10/00',
        ],
      ],
      [
        'a Sold-to that is inactive in the sales area',
        { soldToCustomerNumber: 'PAUSED' },
        ['soldToCustomerNumber PAUSED is inactive in sales area 1000/10/00'],
      ],
      [
        'a Sold-to of another market',
        { ...POLAND, currency: 'PLN' },
        [
          'soldToCustomerNumber CUST-1000 is not assigned to sales area 2000/10/00',
        ],
      ],
      [
        'a sales area that is not configured',
        { distributionChannel: '20' },
        ['salesArea 1000/20/00 does not exist'],
      ],
      [
        'an inactive sales area',
        { salesOrganization: '9000' },
        [
          'salesArea 9000/10/00 is inactive',
          'soldToCustomerNumber CUST-1000 is not assigned to sales area 9000/10/00',
        ],
      ],
      [
        'more decimal places than the currency allows (JPY)',
        { ...JAPAN, amount: '700000.50', currency: undefined },
        ['amount must be a whole amount: JPY has no decimal places'],
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
      [
        'a unit of another sales area',
        'UNIT-JP',
        ['unitId UNIT-JP belongs to sales area 3000/10/00, not 1000/10/00'],
      ],
    ])('should answer 422 for %s', async (_case, unitId, messages) => {
      await expect422(service.create({ ...unitCreate, unitId }), messages);
      expectNoWrites();
    });

    it('should take the currency from the sales area when none is sent', async () => {
      const { currency: _currency, ...withoutCurrency } = soldToCreate;
      await service.create({ ...withoutCurrency, ...JAPAN, amount: '700000' });

      expect(db.priceCondition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ...JAPAN,
          amount: '700000',
          currency: 'JPY',
        }) as unknown,
      });
    });

    it('should accept a JPY amount with zero decimals written out', async () => {
      await service.create({
        ...unitCreate,
        unitId: 'UNIT-JP',
        ...JAPAN,
        currency: 'JPY',
        amount: '700000.00',
      });

      expect(db.priceCondition.create).toHaveBeenCalled();
    });

    it('should create a list price (ZP01) of the sales area without a key', async () => {
      await service.create(listPriceCreate);

      expect(db.priceCondition.create).toHaveBeenCalledWith({
        data: {
          conditionTypeCode: 'ZP01',
          ...GERMANY,
          materialNumber: 'MAT-001',
          scope: 'SALES_AREA',
          soldToCustomerNumber: null,
          unitId: null,
          amount: '4500.00',
          currency: 'EUR',
          validFrom: date('1900-01-01'),
          validTo: null,
          isActive: true,
        },
      });
      expect(db.customer.findUnique).not.toHaveBeenCalled();
      expect(db.b2bUnit.findUnique).not.toHaveBeenCalled();
    });

    it('should check list price overlaps per sales area and material only', async () => {
      await service.create({
        ...listPriceCreate,
        ...POLAND,
        amount: '1899.99',
      });

      expect(db.priceCondition.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          ...POLAND,
          materialNumber: 'MAT-001',
          scope: 'SALES_AREA',
          soldToCustomerNumber: null,
          unitId: null,
        }) as unknown,
        orderBy: { validFrom: 'asc' },
      });
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
          'currency must be EUR, the currency of sales area 1000/10/00',
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

  describe('condition type', () => {
    it.each(['ZP02', 'ZP03'])(
      'should accept the price condition type %s for Sold-to and unit scope',
      async (conditionTypeCode) => {
        await service.create({ ...soldToCreate, conditionTypeCode });
        await service.create({ ...unitCreate, conditionTypeCode });

        expect(db.priceCondition.create).toHaveBeenCalledTimes(2);
        expect(db.priceCondition.create).toHaveBeenLastCalledWith({
          data: expect.objectContaining({
            conditionTypeCode,
            scope: 'B2B_UNIT',
          }) as unknown,
        });
      },
    );

    it.each([
      [
        'an unknown condition type',
        'ZZ99',
        ['conditionTypeCode ZZ99 does not exist'],
      ],
      [
        'an inactive condition type',
        'ZOLD',
        ['conditionTypeCode ZOLD (Retired Price) is inactive'],
      ],
      [
        'the list price ZP01 for a Sold-to (configured for SALES_AREA only)',
        'ZP01',
        [
          'conditionTypeCode ZP01 (List Price) cannot be used with scope SOLD_TO; allowed scopes: SALES_AREA',
        ],
      ],
      [
        'a discount condition type',
        'ZD01',
        [
          'conditionTypeCode ZD01 (Customer Discount) cannot be used for price conditions yet: only condition types of class PRICE with calculation type QUANTITY are supported, not DISCOUNT_SURCHARGE with PERCENTAGE',
        ],
      ],
      [
        'a freight condition type',
        'ZF01',
        [
          'conditionTypeCode ZF01 (Freight) cannot be used for price conditions yet: only condition types of class PRICE with calculation type QUANTITY are supported, not FREIGHT with FIXED_AMOUNT',
        ],
      ],
      [
        'a tax condition type',
        'ZT01',
        [
          'conditionTypeCode ZT01 (Output Tax) cannot be used for price conditions yet: only condition types of class PRICE with calculation type QUANTITY are supported, not TAX with PERCENTAGE',
        ],
      ],
    ])(
      'should answer 422 for %s',
      async (_case, conditionTypeCode, messages) => {
        await expect422(
          service.create({ ...soldToCreate, conditionTypeCode }),
          messages,
        );
        expectNoWrites();
      },
    );

    it.each(['ZP02', 'ZP03'])(
      'should not allow %s as list price of the sales area',
      async (conditionTypeCode) => {
        await expect422(
          service.create({ ...listPriceCreate, conditionTypeCode }),
          [
            `conditionTypeCode ${conditionTypeCode} (${conditionTypeCode === 'ZP02' ? 'Customer Net Price' : 'Special Price'}) cannot be used with scope SALES_AREA; allowed scopes: SOLD_TO, B2B_UNIT`,
          ],
        );
        expectNoWrites();
      },
    );

    it('should report the condition type together with other problems', async () => {
      const error = await service
        .create({
          ...soldToCreate,
          conditionTypeCode: 'ZD01',
          soldToCustomerNumber: 'OLD',
        })
        .catch((e: unknown) => e);
      const messages = (
        (error as UnprocessableEntityException).getResponse() as {
          message: string[];
        }
      ).message;
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatch(/^conditionTypeCode ZD01/);
      expect(messages[1]).toBe('soldToCustomerNumber OLD is inactive');
    });

    it('should map the condition type of a stored record', async () => {
      db.priceCondition.findUnique.mockResolvedValue(
        fullRecord({ conditionTypeCode: 'ZP03' }),
      );

      const condition = await service.findOne(7);

      expect(condition.conditionType).toEqual({
        code: 'ZP03',
        name: 'Special Price',
        conditionClass: 'PRICE',
        calculationType: 'QUANTITY',
      });
    });

    it('should check the condition type again on reactivation', async () => {
      db.priceCondition.findUniqueOrThrow.mockResolvedValue(
        row({ isActive: false, conditionTypeCode: 'ZOLD' }),
      );

      await expect422(service.update(7, { isActive: true }), [
        'conditionTypeCode ZOLD (Retired Price) is inactive',
      ]);
      expectNoWrites();
    });

    it('should keep an active record editable when its condition type became inactive', async () => {
      db.priceCondition.findUniqueOrThrow.mockResolvedValue(
        row({ conditionTypeCode: 'ZOLD' }),
      );

      await service.update(7, { amount: '4100.00' });

      expect(db.conditionType.findUnique).not.toHaveBeenCalled();
      expect(db.priceCondition.update).toHaveBeenCalled();
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

    it('should reject a changed JPY amount with decimal places', async () => {
      db.priceCondition.findUniqueOrThrow.mockResolvedValue(
        row({
          ...JAPAN,
          currency: 'JPY',
          amount: new Prisma.Decimal('700000'),
        }),
      );

      await expect422(service.update(7, { amount: '699999.99' }), [
        'amount must be a whole amount: JPY has no decimal places',
      ]);
      expectNoWrites();
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

      it('should reject a Sold-to that became inactive in the sales area', async () => {
        db.priceCondition.findUniqueOrThrow.mockResolvedValue(
          row({ soldToCustomerNumber: 'PAUSED', isActive: false }),
        );

        await expect422(service.update(7, { isActive: true }), [
          'soldToCustomerNumber PAUSED is inactive in sales area 1000/10/00',
        ]);
      });

      it('should reject a condition in a sales area that became inactive', async () => {
        db.priceCondition.findUniqueOrThrow.mockResolvedValue(
          row({ salesOrganization: '9000', isActive: false }),
        );

        await expect422(service.update(7, { isActive: true }), [
          'salesArea 9000/10/00 is inactive',
          'soldToCustomerNumber CUST-1000 is not assigned to sales area 9000/10/00',
        ]);
      });

      it('should check the configured scopes of the condition type again', async () => {
        // ZP03 is now configured for SOLD_TO only (a configuration change)
        db.conditionType.findUnique.mockImplementation(() => ({
          ...CONDITION_TYPES.find((t) => t.code === 'ZP03'),
          allowedScopes: [{ scope: 'SOLD_TO' }],
        }));
        db.priceCondition.findUniqueOrThrow.mockResolvedValue(
          row({
            conditionTypeCode: 'ZP03',
            scope: 'B2B_UNIT',
            soldToCustomerNumber: null,
            unitId: 'UNIT-S',
            isActive: false,
          }),
        );

        await expect422(service.update(7, { isActive: true }), [
          'conditionTypeCode ZP03 (Special Price) cannot be used with scope B2B_UNIT; allowed scopes: SOLD_TO',
        ]);
        expectNoWrites();
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
