import { UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from './pricing.service';

const date = (text: string) => new Date(`${text}T00:00:00.000Z`);

const material = {
  materialNumber: 'MAT-001',
  description: 'Heat Pump',
  price: new Prisma.Decimal('4500'),
  currency: 'EUR',
};

function unit(changes: { isActive?: boolean; soldToActive?: boolean } = {}) {
  return {
    unitId: 'UNIT-S',
    name: 'Stuttgart',
    isActive: changes.isActive ?? true,
    soldToCustomerNumber: 'CUST-1000',
    soldTo: {
      customer: {
        customerNumber: 'CUST-1000',
        isActive: changes.soldToActive ?? true,
      },
    },
  };
}

/** Condition types as configured by the migration */
const ZP01 = {
  code: 'ZP01',
  name: 'List Price',
  conditionClass: 'PRICE',
  calculationType: 'QUANTITY',
};
const ZP02 = {
  code: 'ZP02',
  name: 'Customer Net Price',
  conditionClass: 'PRICE',
  calculationType: 'QUANTITY',
};
const ZP03 = {
  code: 'ZP03',
  name: 'Special Price',
  conditionClass: 'PRICE',
  calculationType: 'QUANTITY',
};
const listPriceRow = { ...ZP01, isActive: true, sortOrder: 10 };

const unitCondition = {
  conditionId: 12,
  conditionTypeCode: 'ZP03',
  conditionType: { ...ZP03, isActive: true, sortOrder: 30 },
  scope: 'B2B_UNIT',
  amount: new Prisma.Decimal('4200'),
  currency: 'EUR',
  validFrom: date('2026-11-01'),
  validTo: null,
  isActive: true,
};

const soldToCondition = {
  conditionId: 7,
  conditionTypeCode: 'ZP02',
  conditionType: { ...ZP02, isActive: true, sortOrder: 20 },
  scope: 'SOLD_TO',
  amount: new Prisma.Decimal('4350.5'),
  currency: 'EUR',
  validFrom: date('2026-01-01'),
  validTo: date('2026-12-31'),
  isActive: true,
};

const request = {
  materialNumber: 'MAT-001',
  unitId: 'UNIT-S',
  pricingDate: '2026-11-15',
};

describe('PricingService', () => {
  let service: PricingService;

  const db = {
    material: { findUnique: jest.fn() },
    b2bUnit: { findUnique: jest.fn() },
    priceCondition: { findMany: jest.fn() },
    conditionType: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    db.conditionType.findUnique.mockResolvedValue(listPriceRow);
    db.material.findUnique.mockResolvedValue(material);
    db.b2bUnit.findUnique.mockResolvedValue(unit());
    db.priceCondition.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [PricingService, { provide: PrismaService, useValue: db }],
    }).compile();
    service = module.get(PricingService);
  });

  const expect422 = async (messages: string[]) => {
    const error = await service.calculate(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject(
      { statusCode: 422, message: messages },
    );
    expect(db.priceCondition.findMany).not.toHaveBeenCalled();
  };

  it('should return the full result with the winning unit condition', async () => {
    db.priceCondition.findMany.mockResolvedValue([
      soldToCondition,
      unitCondition,
    ]);

    await expect(
      service.calculate({ ...request, quantity: 2 }),
    ).resolves.toEqual({
      materialNumber: 'MAT-001',
      materialDescription: 'Heat Pump',
      unitId: 'UNIT-S',
      soldToCustomerNumber: 'CUST-1000',
      pricingDate: '2026-11-15',
      quantity: 2,
      unitPrice: '4200.00',
      netValue: '8400.00',
      currency: 'EUR',
      source: 'B2B_UNIT',
      conditionType: ZP03,
      conditionId: 12,
      validFrom: '2026-11-01',
      validTo: null,
      steps: [
        {
          source: 'B2B_UNIT',
          conditionId: 12,
          amount: '4200.00',
          applied: true,
          conditionType: ZP03,
        },
        {
          source: 'SOLD_TO',
          conditionId: 7,
          amount: '4350.50',
          applied: false,
          conditionType: ZP02,
        },
        {
          source: 'BASE_PRICE',
          conditionId: null,
          amount: '4500.00',
          applied: false,
          conditionType: ZP01,
        },
      ],
    });
  });

  it('should load active conditions for the unit and its Sold-to', async () => {
    await service.calculate(request);

    expect(db.priceCondition.findMany).toHaveBeenCalledWith({
      where: {
        materialNumber: 'MAT-001',
        isActive: true,
        OR: [
          { scope: 'B2B_UNIT', unitId: 'UNIT-S' },
          { scope: 'SOLD_TO', soldToCustomerNumber: 'CUST-1000' },
        ],
      },
      include: { conditionType: true },
    });
  });

  it('should use the Sold-to price before the unit price starts', async () => {
    db.priceCondition.findMany.mockResolvedValue([
      soldToCondition,
      unitCondition,
    ]);

    await expect(
      service.calculate({ ...request, pricingDate: '2026-10-31' }),
    ).resolves.toMatchObject({
      source: 'SOLD_TO',
      conditionId: 7,
      unitPrice: '4350.50',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
    });
  });

  it('should use the base price for quantity 1 by default', async () => {
    await expect(service.calculate(request)).resolves.toMatchObject({
      quantity: 1,
      unitPrice: '4500.00',
      netValue: '4500.00',
      source: 'BASE_PRICE',
      conditionId: null,
      validFrom: null,
      validTo: null,
    });
  });

  it('should show ZP01 for the base price', async () => {
    const result = await service.calculate(request);

    expect(db.conditionType.findUnique).toHaveBeenCalledWith({
      where: { code: 'ZP01' },
    });
    expect(result.conditionType).toEqual(ZP01);
    expect(result.steps.at(-1)?.conditionType).toEqual(ZP01);
  });

  it('should still use the base price if ZP01 is not configured', async () => {
    db.conditionType.findUnique.mockResolvedValue(null);

    await expect(service.calculate(request)).resolves.toMatchObject({
      unitPrice: '4500.00',
      source: 'BASE_PRICE',
      conditionType: null,
    });
  });

  it('should answer 422 for an unknown material and unit together', async () => {
    db.material.findUnique.mockResolvedValue(null);
    db.b2bUnit.findUnique.mockResolvedValue(null);

    await expect422([
      'materialNumber MAT-001 does not exist',
      'unitId UNIT-S does not exist',
    ]);
  });

  it('should answer 422 for an inactive unit', async () => {
    db.b2bUnit.findUnique.mockResolvedValue(unit({ isActive: false }));

    await expect422(['unitId UNIT-S is inactive']);
  });

  it('should answer 422 for a unit with an inactive Sold-to', async () => {
    db.b2bUnit.findUnique.mockResolvedValue(unit({ soldToActive: false }));

    await expect422(['unitId UNIT-S has an inactive Sold-to CUST-1000']);
  });
});

// Batch pricing for the order simulation; calculate() above is unchanged
describe('PricingService.priceItems', () => {
  const thermostat = {
    materialNumber: 'MAT-002',
    description: 'Thermostat',
    price: new Prisma.Decimal('199'),
    currency: 'EUR',
  };
  const batchDb = {
    material: { findMany: jest.fn() },
    priceCondition: { findMany: jest.fn() },
    conditionType: { findUnique: jest.fn() },
  };
  const service = new PricingService(batchDb as never);
  const stuttgart = { unitId: 'UNIT-S', soldToCustomerNumber: 'CUST-1000' };
  const soldToThermostat = {
    ...soldToCondition,
    materialNumber: 'MAT-002',
    amount: new Prisma.Decimal('189.5'),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    batchDb.conditionType.findUnique.mockResolvedValue(listPriceRow);
    batchDb.material.findMany.mockResolvedValue([material, thermostat]);
    batchDb.priceCondition.findMany.mockResolvedValue([
      { ...unitCondition, materialNumber: 'MAT-001' },
      soldToThermostat,
    ]);
  });

  const price = (items: { materialNumber: string; quantity: number }[]) =>
    service.priceItems({ unit: stuttgart, pricingDate: '2026-11-15', items });

  it('loads materials and conditions once for all positions', async () => {
    await price([
      { materialNumber: 'MAT-001', quantity: 2 },
      { materialNumber: 'MAT-002', quantity: 10 },
      { materialNumber: 'MAT-002', quantity: 5 },
    ]);

    expect(batchDb.material.findMany).toHaveBeenCalledTimes(1);
    expect(batchDb.material.findMany).toHaveBeenCalledWith({
      where: { materialNumber: { in: ['MAT-001', 'MAT-002'] } },
    });
    expect(batchDb.priceCondition.findMany).toHaveBeenCalledTimes(1);
    expect(batchDb.priceCondition.findMany).toHaveBeenCalledWith({
      where: {
        materialNumber: { in: ['MAT-001', 'MAT-002'] },
        isActive: true,
        OR: [
          { scope: 'B2B_UNIT', unitId: 'UNIT-S' },
          { scope: 'SOLD_TO', soldToCustomerNumber: 'CUST-1000' },
        ],
      },
      include: { conditionType: true },
    });
  });

  it('prices every position on its own with the conditions of its material', async () => {
    const result = await price([
      { materialNumber: 'MAT-001', quantity: 2 },
      { materialNumber: 'MAT-002', quantity: 10 },
      { materialNumber: 'MAT-002', quantity: 5 },
    ]);

    expect(
      result.map((r) => [
        r.material?.materialNumber,
        r.determination?.source,
        r.determination?.unitPrice.toFixed(2),
        r.determination?.netValue.toFixed(2),
      ]),
    ).toEqual([
      ['MAT-001', 'B2B_UNIT', '4200.00', '8400.00'],
      ['MAT-002', 'SOLD_TO', '189.50', '1895.00'],
      ['MAT-002', 'SOLD_TO', '189.50', '947.50'],
    ]);
  });

  it('returns no price for an unknown material', async () => {
    batchDb.material.findMany.mockResolvedValue([material]);

    const result = await price([{ materialNumber: 'NOPE', quantity: 1 }]);

    expect(result).toEqual([{ material: null, determination: null }]);
  });

  it('only looks up the materials without a unit', async () => {
    const result = await service.priceItems({
      unit: null,
      pricingDate: '2026-11-15',
      items: [{ materialNumber: 'MAT-001', quantity: 1 }],
    });

    expect(batchDb.priceCondition.findMany).not.toHaveBeenCalled();
    expect(result).toEqual([{ material, determination: null }]);
  });

  it('reads through the given transaction client', async () => {
    const tx = {
      material: { findMany: jest.fn().mockResolvedValue([]) },
      priceCondition: { findMany: jest.fn().mockResolvedValue([]) },
      conditionType: { findUnique: jest.fn().mockResolvedValue(listPriceRow) },
    };

    await service.priceItems(
      {
        unit: stuttgart,
        pricingDate: '2026-11-15',
        items: [{ materialNumber: 'MAT-001', quantity: 1 }],
      },
      tx as never,
    );

    expect(tx.material.findMany).toHaveBeenCalled();
    expect(batchDb.material.findMany).not.toHaveBeenCalled();
  });
});
