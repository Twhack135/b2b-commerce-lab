import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from './customers.service';

// Builds the kind of error Prisma throws for a known database problem
function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('database error', {
    code,
    clientVersion: '7.10.1',
  });
}

const nordwind = {
  customerNumber: 'CUST-0001',
  name: 'Nordwind Heizungsbau GmbH',
  street: 'Hafenstraße 12',
  postalCode: '20457',
  city: 'Hamburg',
  country: 'DE',
  isActive: true,
};

const alpen = {
  customerNumber: 'CUST-0002',
  name: 'Alpen Haustechnik AG',
  street: 'Mariahilfer Straße 88',
  postalCode: '1070',
  city: 'Wien',
  country: 'AT',
  isActive: false,
};

describe('CustomersService', () => {
  let service: CustomersService;

  // A fake PrismaService, so the tests run without a real database
  const prismaMock = {
    customer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  describe('findAll', () => {
    it('should return active and inactive customers sorted by number', async () => {
      prismaMock.customer.findMany.mockResolvedValue([nordwind, alpen]);

      await expect(service.findAll()).resolves.toEqual([nordwind, alpen]);
      expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
        orderBy: { customerNumber: 'asc' },
      });
    });

    it('should only return API fields, even if the record has more', async () => {
      prismaMock.customer.findMany.mockResolvedValue([
        { ...nordwind, internalNote: 'not for the API' },
      ]);

      await expect(service.findAll()).resolves.toEqual([nordwind]);
    });
  });

  describe('findOne', () => {
    it('should return an existing customer', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(nordwind);

      await expect(service.findOne('CUST-0001')).resolves.toEqual(nordwind);
      expect(prismaMock.customer.findUnique).toHaveBeenCalledWith({
        where: { customerNumber: 'CUST-0001' },
      });
    });

    it('should throw NotFoundException for a nonexistent customer', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(null);

      await expect(service.findOne('CUST-404')).rejects.toThrow(
        new NotFoundException('Customer CUST-404 not found'),
      );
    });
  });

  describe('create', () => {
    const { isActive: _isActive, ...withoutStatus } = nordwind;

    it('should create a customer that is active by default', async () => {
      prismaMock.customer.create.mockResolvedValue(nordwind);

      await expect(service.create(withoutStatus)).resolves.toEqual(nordwind);
      expect(prismaMock.customer.create).toHaveBeenCalledWith({
        data: { ...withoutStatus, isActive: true },
      });
    });

    it('should create an inactive customer when requested', async () => {
      prismaMock.customer.create.mockResolvedValue(alpen);

      await service.create(alpen);

      expect(prismaMock.customer.create).toHaveBeenCalledWith({
        data: alpen,
      });
    });

    it('should throw ConflictException for a duplicate customer number', async () => {
      prismaMock.customer.create.mockRejectedValue(prismaError('P2002'));

      await expect(service.create(withoutStatus)).rejects.toThrow(
        new ConflictException('Customer CUST-0001 already exists'),
      );
    });

    it('should pass on unexpected database errors unchanged', async () => {
      const error = prismaError('P1001');
      prismaMock.customer.create.mockRejectedValue(error);

      await expect(service.create(withoutStatus)).rejects.toBe(error);
    });
  });

  describe('update', () => {
    it('should update the given fields and return the customer', async () => {
      prismaMock.customer.update.mockResolvedValue({
        ...nordwind,
        city: 'Bremen',
        isActive: false,
      });

      await expect(
        service.update('CUST-0001', { city: 'Bremen', isActive: false }),
      ).resolves.toEqual({ ...nordwind, city: 'Bremen', isActive: false });
      expect(prismaMock.customer.update).toHaveBeenCalledWith({
        where: { customerNumber: 'CUST-0001' },
        data: {
          name: undefined,
          street: undefined,
          postalCode: undefined,
          city: 'Bremen',
          country: undefined,
          isActive: false,
        },
      });
    });

    it('should throw NotFoundException for a nonexistent customer', async () => {
      prismaMock.customer.update.mockRejectedValue(prismaError('P2025'));

      await expect(
        service.update('CUST-404', { city: 'Bremen' }),
      ).rejects.toThrow(new NotFoundException('Customer CUST-404 not found'));
    });

    it('should pass on unexpected database errors unchanged', async () => {
      const error = prismaError('P1001');
      prismaMock.customer.update.mockRejectedValue(error);

      await expect(
        service.update('CUST-0001', { city: 'Bremen' }),
      ).rejects.toBe(error);
    });
  });
});
