import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerSalesAreasService } from './customer-sales-areas.service';

const GERMANY = {
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
};
const POLAND = { ...GERMANY, salesOrganization: '2000' };

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('database error', {
    code,
    clientVersion: '7.10.1',
  });
}

describe('CustomerSalesAreasService', () => {
  let service: CustomerSalesAreasService;

  const db = {
    $transaction: jest.fn(),
    // Assignment row lock: SELECT ... FOR UPDATE
    $queryRaw: jest.fn(),
    customer: { findUnique: jest.fn() },
    salesArea: { findUnique: jest.fn() },
    customerSalesArea: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    b2bUnit: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    db.$transaction.mockImplementation((callback: (tx: typeof db) => unknown) =>
      callback(db),
    );
    db.customer.findUnique.mockResolvedValue({ customerNumber: 'ACC' });
    db.salesArea.findUnique.mockResolvedValue({
      ...POLAND,
      isActive: true,
      organization: { isActive: true },
    });
    db.b2bUnit.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerSalesAreasService,
        { provide: PrismaService, useValue: db },
      ],
    }).compile();
    service = module.get(CustomerSalesAreasService);
  });

  describe('create', () => {
    beforeEach(() => {
      // First: "does the assignment exist?" -> no. Then: reload after commit.
      db.customerSalesArea.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValue({
          customerNumber: 'ACC',
          ...POLAND,
          isActive: true,
        });
    });

    it('should assign the customer to the sales area', async () => {
      await expect(service.create('ACC', POLAND)).resolves.toEqual({
        customerNumber: 'ACC',
        ...POLAND,
        isActive: true,
      });
      expect(db.customerSalesArea.create).toHaveBeenCalledWith({
        data: { customerNumber: 'ACC', ...POLAND, isActive: true },
      });
    });

    it('should throw NotFoundException for an unknown customer', async () => {
      db.customer.findUnique.mockResolvedValue(null);

      await expect(service.create('GHOST', POLAND)).rejects.toThrow(
        new NotFoundException('Customer GHOST not found'),
      );
      expect(db.customerSalesArea.create).not.toHaveBeenCalled();
    });

    it.each([
      ['does not exist', null, 'salesArea 2000/10/00 does not exist'],
      [
        'is inactive',
        { isActive: false, organization: { isActive: true } },
        'salesArea 2000/10/00 is inactive',
      ],
      [
        'belongs to an inactive sales organization',
        { isActive: true, organization: { isActive: false } },
        'salesArea 2000/10/00 is inactive',
      ],
    ])('should reject a sales area that %s', async (_case, area, message) => {
      db.salesArea.findUnique.mockResolvedValue(area);

      const error = await service.create('ACC', POLAND).catch((e) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getResponse().message).toEqual([message]);
      expect(db.customerSalesArea.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictException for an existing assignment', async () => {
      db.customerSalesArea.findUnique
        .mockReset()
        .mockResolvedValue({ customerNumber: 'ACC', ...POLAND });

      await expect(service.create('ACC', POLAND)).rejects.toThrow(
        new ConflictException(
          'Customer ACC is already assigned to sales area 2000/10/00',
        ),
      );
    });

    it('should map a duplicate key during the insert to 409', async () => {
      db.customerSalesArea.create.mockRejectedValue(prismaError('P2002'));

      await expect(service.create('ACC', POLAND)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    const lockResult = (isActive: boolean) => [{ is_active: isActive }];

    beforeEach(() => {
      db.$queryRaw.mockResolvedValue(lockResult(true));
      db.customerSalesArea.findUnique.mockResolvedValue({
        customerNumber: 'ACC',
        ...GERMANY,
        isActive: false,
      });
    });

    it('should lock the assignment with a parameterized query', async () => {
      await service.update('ACC', GERMANY, { isActive: false });

      const [strings, ...values] = db.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      expect(strings.join('?')).toMatch(
        /FROM customer_sales_areas[\s\S]*FOR UPDATE/,
      );
      expect(values).toEqual(['ACC', '1000', '10', '00']);
    });

    it('should deactivate an assignment that no active unit uses', async () => {
      await expect(
        service.update('ACC', GERMANY, { isActive: false }),
      ).resolves.toEqual({
        customerNumber: 'ACC',
        ...GERMANY,
        isActive: false,
      });
      expect(db.customerSalesArea.update).toHaveBeenCalledWith({
        where: {
          customerNumber_salesOrganization_distributionChannel_division: {
            customerNumber: 'ACC',
            ...GERMANY,
          },
        },
        data: { isActive: false },
      });
    });

    it('should look for active units that use the customer in any partner function', async () => {
      await service.update('ACC', GERMANY, { isActive: false });

      expect(db.b2bUnit.findMany).toHaveBeenCalledWith({
        where: {
          ...GERMANY,
          isActive: true,
          OR: [
            { soldToCustomerNumber: 'ACC' },
            { billToCustomerNumber: 'ACC' },
            { payerCustomerNumber: 'ACC' },
            { shipTos: { some: { customerNumber: 'ACC' } } },
          ],
        },
        select: { unitId: true },
        orderBy: { unitId: 'asc' },
      });
    });

    it('should refuse to deactivate while active units depend on it', async () => {
      db.b2bUnit.findMany.mockResolvedValue([
        { unitId: 'UNIT-A' },
        { unitId: 'UNIT-B' },
      ]);

      await expect(
        service.update('ACC', GERMANY, { isActive: false }),
      ).rejects.toThrow(
        new ConflictException(
          'Customer ACC cannot be deactivated in sales area 1000/10/00: it is a partner of the active B2B unit(s) UNIT-A, UNIT-B. Deactivate these units or replace the partner first.',
        ),
      );
      expect(db.customerSalesArea.update).not.toHaveBeenCalled();
    });

    it('should reactivate only in an active sales area', async () => {
      db.$queryRaw.mockResolvedValue(lockResult(false));
      db.salesArea.findUnique.mockResolvedValue({
        ...GERMANY,
        isActive: false,
        organization: { isActive: true },
      });

      await expect(
        service.update('ACC', GERMANY, { isActive: true }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(db.customerSalesArea.update).not.toHaveBeenCalled();
    });

    it('should not write anything if the status does not change', async () => {
      db.customerSalesArea.findUnique.mockResolvedValue({
        customerNumber: 'ACC',
        ...GERMANY,
        isActive: true,
      });

      await service.update('ACC', GERMANY, { isActive: true });

      expect(db.customerSalesArea.update).not.toHaveBeenCalled();
      expect(db.b2bUnit.findMany).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for a missing assignment', async () => {
      db.$queryRaw.mockResolvedValue([]);

      await expect(
        service.update('ACC', POLAND, { isActive: false }),
      ).rejects.toThrow(
        new NotFoundException(
          'Customer ACC is not assigned to sales area 2000/10/00',
        ),
      );
    });

    it('should throw NotFoundException for an unknown customer', async () => {
      db.$queryRaw.mockResolvedValue([]);
      db.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.update('GHOST', GERMANY, { isActive: false }),
      ).rejects.toThrow(new NotFoundException('Customer GHOST not found'));
    });

    it('should treat a malformed sales area as not assigned without a query', async () => {
      await expect(
        service.update(
          'ACC',
          { ...GERMANY, salesOrganization: '10' },
          { isActive: false },
        ),
      ).rejects.toThrow(NotFoundException);
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
