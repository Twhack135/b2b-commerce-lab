import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MaterialsService } from './materials.service';

// Builds the kind of error Prisma throws for a known database problem
function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('database error', {
    code,
    clientVersion: '7.10.0',
  });
}

const heatPumpRecord = {
  materialNumber: 'MAT-001',
  description: 'Heat Pump',
  price: new Prisma.Decimal('4500.00'),
  currency: 'EUR',
};

const thermostatRecord = {
  materialNumber: 'MAT-002',
  description: 'Thermostat',
  price: new Prisma.Decimal('199.00'),
  currency: 'EUR',
};

describe('MaterialsService', () => {
  let service: MaterialsService;

  // A fake PrismaService, so the tests run without a real database
  const prismaMock = {
    $transaction: jest.fn(),
    // Row lock: SELECT ... FOR UPDATE
    $queryRaw: jest.fn(),
    material: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    priceCondition: { count: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaterialsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<MaterialsService>(MaterialsService);
  });

  describe('findAll', () => {
    it('should return all materials with prices as numbers', async () => {
      prismaMock.material.findMany.mockResolvedValue([
        heatPumpRecord,
        thermostatRecord,
      ]);

      await expect(service.findAll()).resolves.toEqual([
        {
          materialNumber: 'MAT-001',
          description: 'Heat Pump',
          price: 4500,
          currency: 'EUR',
        },
        {
          materialNumber: 'MAT-002',
          description: 'Thermostat',
          price: 199,
          currency: 'EUR',
        },
      ]);
      expect(prismaMock.material.findMany).toHaveBeenCalledWith({
        orderBy: { materialNumber: 'asc' },
      });
    });
  });

  describe('findOne', () => {
    it('should return an existing material', async () => {
      prismaMock.material.findUnique.mockResolvedValue(heatPumpRecord);

      await expect(service.findOne('MAT-001')).resolves.toEqual({
        materialNumber: 'MAT-001',
        description: 'Heat Pump',
        price: 4500,
        currency: 'EUR',
      });
      expect(prismaMock.material.findUnique).toHaveBeenCalledWith({
        where: { materialNumber: 'MAT-001' },
      });
    });

    it('should throw NotFoundException for a nonexistent material', async () => {
      prismaMock.material.findUnique.mockResolvedValue(null);

      await expect(service.findOne('MAT-404')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    const dto = {
      materialNumber: 'MAT-003',
      description: 'Circulation Pump',
      price: 349.99,
      currency: 'EUR',
    };

    it('should create a valid material', async () => {
      prismaMock.material.create.mockResolvedValue({
        ...dto,
        price: new Prisma.Decimal('349.99'),
      });

      await expect(service.create(dto)).resolves.toEqual(dto);
      expect(prismaMock.material.create).toHaveBeenCalledWith({ data: dto });
    });

    it('should throw ConflictException for a duplicate material number', async () => {
      prismaMock.material.create.mockRejectedValue(prismaError('P2002'));

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('should pass on unexpected database errors unchanged', async () => {
      const error = prismaError('P1001');
      prismaMock.material.create.mockRejectedValue(error);

      await expect(service.create(dto)).rejects.toBe(error);
    });
  });

  describe('update', () => {
    it('should update an existing material', async () => {
      prismaMock.material.update.mockResolvedValue({
        materialNumber: 'MAT-003',
        description: 'High Efficiency Circulation Pump',
        price: new Prisma.Decimal('399.99'),
        currency: 'EUR',
      });

      await expect(
        service.update('MAT-003', {
          description: 'High Efficiency Circulation Pump',
          price: 399.99,
        }),
      ).resolves.toEqual({
        materialNumber: 'MAT-003',
        description: 'High Efficiency Circulation Pump',
        price: 399.99,
        currency: 'EUR',
      });
      expect(prismaMock.material.update).toHaveBeenCalledWith({
        where: { materialNumber: 'MAT-003' },
        data: {
          description: 'High Efficiency Circulation Pump',
          price: 399.99,
          currency: undefined,
        },
      });
    });

    it('should throw NotFoundException for a nonexistent material', async () => {
      prismaMock.material.update.mockRejectedValue(prismaError('P2025'));

      await expect(
        service.update('MAT-404', { description: 'Does not matter' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not check price conditions when the currency is not changed', async () => {
      prismaMock.material.update.mockResolvedValue(heatPumpRecord);

      await service.update('MAT-001', { price: 4500 });

      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
      expect(prismaMock.priceCondition.count).not.toHaveBeenCalled();
    });

    it('should change the currency when no active condition uses another one', async () => {
      prismaMock.priceCondition.count.mockResolvedValue(0);
      prismaMock.material.update.mockResolvedValue({
        ...heatPumpRecord,
        currency: 'CHF',
      });

      await expect(
        service.update('MAT-001', { currency: 'CHF' }),
      ).resolves.toMatchObject({ currency: 'CHF' });
      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prismaMock.priceCondition.count).toHaveBeenCalledWith({
        where: {
          materialNumber: 'MAT-001',
          isActive: true,
          currency: { not: 'CHF' },
        },
      });
    });

    it('should reject a currency change while active conditions use another currency', async () => {
      prismaMock.priceCondition.count.mockResolvedValue(2);

      const error = await service
        .update('MAT-001', { currency: 'CHF' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(
        (error as UnprocessableEntityException).getResponse(),
      ).toMatchObject({
        statusCode: 422,
        message: [
          'currency cannot be changed to CHF: material MAT-001 has 2 active price condition(s) in another currency',
        ],
      });
      expect(prismaMock.material.update).not.toHaveBeenCalled();
    });
  });

  describe('Decimal price conversion', () => {
    it.each([
      ['4500.00', 4500],
      ['349.99', 349.99],
      ['0.01', 0.01],
      ['9999999999.99', 9999999999.99],
    ])(
      'should convert Decimal %s to the number %d',
      async (stored, expected) => {
        prismaMock.material.findUnique.mockResolvedValue({
          ...heatPumpRecord,
          price: new Prisma.Decimal(stored),
        });

        const material = await service.findOne('MAT-001');

        expect(material.price).toBe(expected);
        expect(typeof material.price).toBe('number');
      },
    );
  });
});
