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

const unitCondition = {
  conditionId: 12,
  scope: 'B2B_UNIT',
  amount: new Prisma.Decimal('4200'),
  currency: 'EUR',
  validFrom: date('2026-11-01'),
  validTo: null,
  isActive: true,
};

const soldToCondition = {
  conditionId: 7,
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
  };

  beforeEach(async () => {
    jest.resetAllMocks();
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
      conditionId: 12,
      validFrom: '2026-11-01',
      validTo: null,
      steps: [
        {
          source: 'B2B_UNIT',
          conditionId: 12,
          amount: '4200.00',
          applied: true,
        },
        {
          source: 'SOLD_TO',
          conditionId: 7,
          amount: '4350.50',
          applied: false,
        },
        {
          source: 'BASE_PRICE',
          conditionId: null,
          amount: '4500.00',
          applied: false,
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
