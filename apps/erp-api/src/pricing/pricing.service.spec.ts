import { UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from './pricing.service';

const date = (text: string) => new Date(`${text}T00:00:00.000Z`);

const GERMANY = {
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
};
const POLAND = { ...GERMANY, salesOrganization: '2000' };
const JAPAN = { ...GERMANY, salesOrganization: '3000' };

// Since Sprint 9C-B the material price is deprecated and never used
const material = {
  materialNumber: 'MAT-001',
  description: 'Heat Pump',
  price: new Prisma.Decimal('9999'),
  currency: 'EUR',
};

function unit(
  changes: {
    isActive?: boolean;
    soldToActive?: boolean;
    salesArea?: typeof GERMANY;
  } = {},
) {
  return {
    unitId: 'UNIT-S',
    name: 'Stuttgart',
    isActive: changes.isActive ?? true,
    soldToCustomerNumber: 'CUST-1000',
    ...(changes.salesArea ?? GERMANY),
    soldTo: {
      customer: {
        customerNumber: 'CUST-1000',
        isActive: changes.soldToActive ?? true,
      },
    },
  };
}

/** A sales area row as loaded with its organization and currency */
function salesAreaRow(
  key: typeof GERMANY,
  currency: { code: string; decimals: number },
  isActive = true,
) {
  return {
    ...key,
    isActive,
    organization: { code: key.salesOrganization, isActive: true, currency },
  };
}
const EUR = { code: 'EUR', decimals: 2 };
const JPY = { code: 'JPY', decimals: 0 };

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

const unitCondition = {
  conditionId: 12,
  conditionTypeCode: 'ZP03',
  conditionType: { ...ZP03, isActive: true, sortOrder: 30 },
  scope: 'B2B_UNIT',
  ...GERMANY,
  materialNumber: 'MAT-001',
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
  ...GERMANY,
  materialNumber: 'MAT-001',
  amount: new Prisma.Decimal('4350.5'),
  currency: 'EUR',
  validFrom: date('2026-01-01'),
  validTo: date('2026-12-31'),
  isActive: true,
};

const listPrice = {
  conditionId: 5,
  conditionTypeCode: 'ZP01',
  conditionType: { ...ZP01, isActive: true, sortOrder: 10 },
  scope: 'SALES_AREA',
  ...GERMANY,
  materialNumber: 'MAT-001',
  amount: new Prisma.Decimal('4500'),
  currency: 'EUR',
  validFrom: date('1900-01-01'),
  validTo: null,
  isActive: true,
};

const request = {
  materialNumber: 'MAT-001',
  unitId: 'UNIT-S',
  ...GERMANY,
  pricingDate: '2026-11-15',
};

describe('PricingService', () => {
  let service: PricingService;

  const db = {
    material: { findUnique: jest.fn() },
    b2bUnit: { findUnique: jest.fn() },
    salesArea: { findUnique: jest.fn() },
    priceCondition: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    db.material.findUnique.mockResolvedValue(material);
    db.b2bUnit.findUnique.mockResolvedValue(unit());
    db.salesArea.findUnique.mockResolvedValue(salesAreaRow(GERMANY, EUR));
    db.priceCondition.findMany.mockResolvedValue([listPrice]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [PricingService, { provide: PrismaService, useValue: db }],
    }).compile();
    service = module.get(PricingService);
  });

  const failure = async (body = request) => {
    const error = await service.calculate(body).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    return (error as UnprocessableEntityException).getResponse() as Record<
      string,
      unknown
    >;
  };

  const expect422 = async (messages: string[], body = request) => {
    expect(await failure(body)).toMatchObject({
      statusCode: 422,
      message: messages,
    });
    expect(db.priceCondition.findMany).not.toHaveBeenCalled();
  };

  it('should return the full result with the winning unit condition', async () => {
    db.priceCondition.findMany.mockResolvedValue([
      listPrice,
      soldToCondition,
      unitCondition,
    ]);

    await expect(
      service.calculate({ ...request, quantity: 2 }),
    ).resolves.toEqual({
      materialNumber: 'MAT-001',
      materialDescription: 'Heat Pump',
      salesArea: GERMANY,
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
          source: 'SALES_AREA',
          conditionId: 5,
          amount: '4500.00',
          applied: false,
          conditionType: ZP01,
        },
      ],
    });
  });

  it('should load only active conditions of the requested sales area', async () => {
    await service.calculate(request);

    expect(db.priceCondition.findMany).toHaveBeenCalledWith({
      where: {
        ...GERMANY,
        materialNumber: { in: ['MAT-001'] },
        isActive: true,
        OR: [
          { scope: 'B2B_UNIT', unitId: 'UNIT-S' },
          { scope: 'SOLD_TO', soldToCustomerNumber: 'CUST-1000' },
          { scope: 'SALES_AREA' },
        ],
      },
      include: { conditionType: true },
    });
  });

  it('should use the Sold-to price before the unit price starts', async () => {
    db.priceCondition.findMany.mockResolvedValue([
      listPrice,
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

  it('should use the ZP01 list price, never the deprecated material price', async () => {
    await expect(service.calculate(request)).resolves.toMatchObject({
      quantity: 1,
      unitPrice: '4500.00',
      netValue: '4500.00',
      source: 'SALES_AREA',
      conditionType: ZP01,
      conditionId: 5,
      validFrom: '1900-01-01',
      validTo: null,
    });
  });

  it('should answer 422 NO_PRICE_FOUND with the pricing analysis', async () => {
    db.priceCondition.findMany.mockResolvedValue([]);

    expect(await failure()).toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      code: 'NO_PRICE_FOUND',
      message: [
        'No price found for material MAT-001 in sales area 1000/10/00 on 2026-11-15',
      ],
      steps: [
        {
          source: 'B2B_UNIT',
          conditionId: null,
          amount: null,
          applied: false,
          conditionType: null,
        },
        {
          source: 'SOLD_TO',
          conditionId: null,
          amount: null,
          applied: false,
          conditionType: null,
        },
        {
          source: 'SALES_AREA',
          conditionId: null,
          amount: null,
          applied: false,
          conditionType: null,
        },
      ],
    });
  });

  it('should price in the currency of the sales area without decimals for JPY', async () => {
    db.salesArea.findUnique.mockResolvedValue(salesAreaRow(JAPAN, JPY));
    db.b2bUnit.findUnique.mockResolvedValue(unit({ salesArea: JAPAN }));
    db.priceCondition.findMany.mockResolvedValue([
      {
        ...listPrice,
        ...JAPAN,
        amount: new Prisma.Decimal('700000'),
        currency: 'JPY',
      },
    ]);

    await expect(
      service.calculate({ ...request, ...JAPAN, quantity: 3 }),
    ).resolves.toMatchObject({
      salesArea: JAPAN,
      currency: 'JPY',
      unitPrice: '700000',
      netValue: '2100000',
      steps: [
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ amount: '700000' }),
      ],
    });
  });

  it('should reject a unit of another sales area without loading prices', async () => {
    db.salesArea.findUnique.mockResolvedValue(salesAreaRow(POLAND, EUR));

    await expect422(
      ['unitId UNIT-S belongs to sales area 1000/10/00, not 2000/10/00'],
      { ...request, ...POLAND },
    );
  });

  it('should answer 422 for a sales area that does not exist or is inactive', async () => {
    db.salesArea.findUnique.mockResolvedValue(null);
    await expect422(['salesArea 1000/20/00 does not exist'], {
      ...request,
      distributionChannel: '20',
    });

    db.salesArea.findUnique.mockResolvedValue(
      salesAreaRow(GERMANY, EUR, false),
    );
    await expect422(['salesArea 1000/10/00 is inactive']);
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

// Batch pricing for the order simulation
describe('PricingService.priceItems', () => {
  const thermostat = {
    materialNumber: 'MAT-002',
    description: 'Thermostat',
    price: null,
    currency: null,
  };
  const batchDb = {
    material: { findMany: jest.fn() },
    priceCondition: { findMany: jest.fn() },
  };
  const service = new PricingService(batchDb as never);
  const stuttgart = { unitId: 'UNIT-S', soldToCustomerNumber: 'CUST-1000' };
  const germany = {
    key: GERMANY,
    isActive: true,
    currency: EUR,
  };
  const soldToThermostat = {
    ...soldToCondition,
    materialNumber: 'MAT-002',
    amount: new Prisma.Decimal('189.5'),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    batchDb.material.findMany.mockResolvedValue([material, thermostat]);
    batchDb.priceCondition.findMany.mockResolvedValue([
      unitCondition,
      listPrice,
      soldToThermostat,
    ]);
  });

  const price = (items: { materialNumber: string; quantity: number }[]) =>
    service.priceItems({
      unit: stuttgart,
      salesArea: germany,
      pricingDate: '2026-11-15',
      items,
    });

  it('loads materials and conditions of the sales area once for all positions', async () => {
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
        ...GERMANY,
        materialNumber: { in: ['MAT-001', 'MAT-002'] },
        isActive: true,
        OR: [
          { scope: 'B2B_UNIT', unitId: 'UNIT-S' },
          { scope: 'SOLD_TO', soldToCustomerNumber: 'CUST-1000' },
          { scope: 'SALES_AREA' },
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
      result.map((r) =>
        r.determination?.status === 'PRICED'
          ? [
              r.material?.materialNumber,
              r.determination.source,
              r.determination.unitPrice.toFixed(2),
              r.determination.netValue.toFixed(2),
            ]
          : r.determination?.status,
      ),
    ).toEqual([
      ['MAT-001', 'B2B_UNIT', '4200.00', '8400.00'],
      ['MAT-002', 'SOLD_TO', '189.50', '1895.00'],
      ['MAT-002', 'SOLD_TO', '189.50', '947.50'],
    ]);
  });

  it('reports NO_PRICE_FOUND for a material without any condition', async () => {
    batchDb.priceCondition.findMany.mockResolvedValue([]);

    const [result] = await price([{ materialNumber: 'MAT-002', quantity: 1 }]);

    expect(result.material).toEqual(thermostat);
    expect(result.determination?.status).toBe('NO_PRICE_FOUND');
  });

  it('returns no price for an unknown material', async () => {
    batchDb.material.findMany.mockResolvedValue([material]);

    const result = await price([{ materialNumber: 'NOPE', quantity: 1 }]);

    expect(result).toEqual([{ material: null, determination: null }]);
  });

  it.each([
    ['without a unit', { unit: null, salesArea: germany }],
    ['without a sales area', { unit: stuttgart, salesArea: null }],
  ])('only looks up the materials %s', async (_case, context) => {
    const result = await service.priceItems({
      ...context,
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
    };

    await service.priceItems(
      {
        unit: stuttgart,
        salesArea: germany,
        pricingDate: '2026-11-15',
        items: [{ materialNumber: 'MAT-001', quantity: 1 }],
      },
      tx as never,
    );

    expect(tx.material.findMany).toHaveBeenCalled();
    expect(batchDb.material.findMany).not.toHaveBeenCalled();
  });
});
