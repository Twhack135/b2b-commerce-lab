import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MaterialsService } from './materials.service';

describe('MaterialsService', () => {
  let service: MaterialsService;

  // A fake PrismaService, so the test runs without a real database
  const prismaMock = {
    material: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    prismaMock.material.findMany.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaterialsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<MaterialsService>(MaterialsService);
  });

  it('should return materials from the database with prices as numbers', async () => {
    prismaMock.material.findMany.mockResolvedValue([
      {
        materialNumber: 'MAT-001',
        description: 'Heat Pump',
        price: new Prisma.Decimal('4500.00'),
        currency: 'EUR',
      },
      {
        materialNumber: 'MAT-002',
        description: 'Thermostat',
        price: new Prisma.Decimal('199.00'),
        currency: 'EUR',
      },
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
