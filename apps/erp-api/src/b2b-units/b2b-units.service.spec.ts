import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { B2bUnitsService } from './b2b-units.service';
import { CreateB2bUnitDto } from './dto/create-b2b-unit.dto';

type TestCustomer = {
  customerNumber: string;
  name: string;
  isActive: boolean;
  account: string | null;
};

// Account ACC (owner) with members; OTHER is a different account
const CUSTOMERS: TestCustomer[] = [
  {
    customerNumber: 'ACC',
    name: 'Account Owner',
    isActive: true,
    account: 'ACC',
  },
  {
    customerNumber: 'SH1',
    name: 'Ship-to One',
    isActive: true,
    account: 'ACC',
  },
  {
    customerNumber: 'SH2',
    name: 'Ship-to Two',
    isActive: true,
    account: 'ACC',
  },
  {
    customerNumber: 'BP1',
    name: 'Bill-to One',
    isActive: true,
    account: 'ACC',
  },
  {
    customerNumber: 'OLD',
    name: 'Inactive Member',
    isActive: false,
    account: 'ACC',
  },
  {
    customerNumber: 'OTHER',
    name: 'Other Owner',
    isActive: true,
    account: 'OTHER',
  },
  {
    customerNumber: 'OM',
    name: 'Other Member',
    isActive: true,
    account: 'OTHER',
  },
  { customerNumber: 'LONE', name: 'No Account', isActive: true, account: null },
  {
    customerNumber: 'SLEEP',
    name: 'Inactive Owner',
    isActive: false,
    account: 'SLEEP',
  },
  // Members of ACC without an (active) assignment to sales area 1000/10/00
  {
    customerNumber: 'NOAREA',
    name: 'Not Assigned',
    isActive: true,
    account: 'ACC',
  },
  {
    customerNumber: 'PAUSED',
    name: 'Inactive Assignment',
    isActive: true,
    account: 'ACC',
  },
];

const DE = {
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
};
const PL = {
  salesOrganization: '2000',
  distributionChannel: '10',
  division: '00',
};

// Configured sales areas; 9000 belongs to an inactive sales organization
const SALES_AREAS = [
  { ...DE, isActive: true, organization: { isActive: true } },
  { ...PL, isActive: true, organization: { isActive: true } },
  {
    salesOrganization: '9000',
    distributionChannel: '10',
    division: '00',
    isActive: true,
    organization: { isActive: false },
  },
];

/** Assignment status per sales area; missing customers are not assigned */
const ASSIGNMENTS: Record<string, Record<string, boolean>> = {
  '1000/10/00': Object.fromEntries(
    CUSTOMERS.filter((c) => c.customerNumber !== 'NOAREA').map((c) => [
      c.customerNumber,
      c.customerNumber !== 'PAUSED',
    ]),
  ),
  // Only the account owner sells in Poland
  '2000/10/00': { ACC: true },
};

function customerRecord(customerNumber: string) {
  const c = CUSTOMERS.find((x) => x.customerNumber === customerNumber);
  if (!c) return null;
  return {
    customerNumber: c.customerNumber,
    name: c.name,
    isActive: c.isActive,
    accountMembership: c.account
      ? {
          customerNumber: c.customerNumber,
          accountCustomerNumber: c.account,
          accountOwnerRef: c.account,
        }
      : null,
  };
}

const summary = (n: string) => {
  const c = CUSTOMERS.find((x) => x.customerNumber === n)!;
  return {
    customerNumber: c.customerNumber,
    name: c.name,
    isActive: c.isActive,
  };
};
const member = (n: string) => ({ customer: summary(n) });

/** A unit as loaded by the service with all includes */
function unitRecord(
  options: {
    billTo?: string;
    shipTos?: { customerNumber: string; isDefault: boolean }[];
    isActive?: boolean;
    salesArea?: typeof DE;
  } = {},
) {
  return {
    unitId: 'UNIT-1',
    name: 'Hamburg Plant',
    accountCustomerNumber: 'ACC',
    soldToCustomerNumber: 'ACC',
    billToCustomerNumber: options.billTo ?? 'BP1',
    payerCustomerNumber: 'ACC',
    isActive: options.isActive ?? true,
    ...(options.salesArea ?? DE),
    soldTo: { ...member('ACC'), owner: member('ACC') },
    billTo: member(options.billTo ?? 'BP1'),
    payer: member('ACC'),
    shipTos: (
      options.shipTos ?? [
        { customerNumber: 'SH1', isDefault: true },
        { customerNumber: 'SH2', isDefault: false },
      ]
    ).map((s) => ({
      ...s,
      unitId: 'UNIT-1',
      accountCustomerNumber: 'ACC',
      member: member(s.customerNumber),
    })),
  };
}

// A plain object (not a class instance), so it can be copied with spread
const validCreate = {
  unitId: 'UNIT-1',
  name: 'Hamburg Plant',
  ...DE,
  accountCustomerNumber: 'ACC',
  soldToCustomerNumber: 'ACC',
  billToCustomerNumber: 'BP1',
  payerCustomerNumber: 'ACC',
  shipToCustomerNumbers: ['SH1', 'SH2'],
  defaultShipToCustomerNumber: 'SH1',
} satisfies CreateB2bUnitDto;

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('database error', {
    code,
    clientVersion: '7.10.1',
  });
}

describe('B2bUnitsService', () => {
  let service: B2bUnitsService;

  const db = {
    $transaction: jest.fn(),
    // Row lock: SELECT ... FOR UPDATE
    $queryRaw: jest.fn(),
    customer: { findUnique: jest.fn(), findMany: jest.fn() },
    salesArea: { findUnique: jest.fn() },
    b2bUnit: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    b2bUnitShipTo: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    db.$transaction.mockImplementation((callback: (tx: typeof db) => unknown) =>
      callback(db),
    );
    db.customer.findUnique.mockImplementation(
      ({ where }: { where: { customerNumber: string } }) =>
        customerRecord(where.customerNumber),
    );
    db.customer.findMany.mockImplementation(
      ({ where }: { where: { customerNumber: { in: string[] } } }) =>
        where.customerNumber.in.map(customerRecord).filter(Boolean),
    );
    db.b2bUnitShipTo.count.mockResolvedValue(1);
    db.salesArea.findUnique.mockImplementation(
      ({
        where,
      }: {
        where: { salesOrganization_distributionChannel_division: typeof DE };
      }) => {
        const key = where.salesOrganization_distributionChannel_division;
        return (
          SALES_AREAS.find(
            (a) =>
              a.salesOrganization === key.salesOrganization &&
              a.distributionChannel === key.distributionChannel &&
              a.division === key.division,
          ) ?? null
        );
      },
    );
    // Two raw queries: the unit row lock and the assignment lock
    db.$queryRaw.mockImplementation(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (!strings.join('?').includes('customer_sales_areas')) {
          return [{ unit_id: 'UNIT-1' }];
        }
        const [numbers, org, channel, division] = values as [
          string[],
          string,
          string,
          string,
        ];
        const assigned = ASSIGNMENTS[`${org}/${channel}/${division}`] ?? {};
        return numbers
          .filter((n) => n in assigned)
          .map((n) => ({ customer_number: n, is_active: assigned[n] }));
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [B2bUnitsService, { provide: PrismaService, useValue: db }],
    }).compile();
    service = module.get(B2bUnitsService);
  });

  const expectNoWrites = () => {
    expect(db.b2bUnit.create).not.toHaveBeenCalled();
    expect(db.b2bUnit.update).not.toHaveBeenCalled();
    expect(db.b2bUnitShipTo.createMany).not.toHaveBeenCalled();
    expect(db.b2bUnitShipTo.deleteMany).not.toHaveBeenCalled();
    expect(db.b2bUnitShipTo.update).not.toHaveBeenCalled();
  };

  const expect422 = async (promise: Promise<unknown>, messages: string[]) => {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject(
      {
        statusCode: 422,
        message: messages,
      },
    );
  };

  describe('findAll and findOne', () => {
    it('should map units with account, partners and default ship-to', async () => {
      db.b2bUnit.findMany.mockResolvedValue([unitRecord()]);

      await expect(service.findAll()).resolves.toEqual([
        {
          unitId: 'UNIT-1',
          name: 'Hamburg Plant',
          isActive: true,
          salesArea: DE,
          account: summary('ACC'),
          soldTo: summary('ACC'),
          billTo: summary('BP1'),
          payer: summary('ACC'),
          shipTos: [
            { ...summary('SH1'), isDefault: true },
            { ...summary('SH2'), isDefault: false },
          ],
          defaultShipToCustomerNumber: 'SH1',
        },
      ]);
    });

    it('should show partners that became inactive', async () => {
      db.b2bUnit.findUnique.mockResolvedValue(unitRecord({ billTo: 'OLD' }));

      const unit = await service.findOne('UNIT-1');

      expect(unit.billTo).toEqual({
        customerNumber: 'OLD',
        name: 'Inactive Member',
        isActive: false,
      });
    });

    it('should throw NotFoundException for an unknown unit', async () => {
      db.b2bUnit.findUnique.mockResolvedValue(null);

      await expect(service.findOne('NOPE')).rejects.toThrow(
        new NotFoundException('B2B unit NOPE not found'),
      );
    });
  });

  describe('create', () => {
    beforeEach(() => {
      // First: "does the unit exist?" -> no. Then: reload after the commit.
      db.b2bUnit.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValue(unitRecord());
    });

    it('should create the unit and its ship-tos in one transaction', async () => {
      const unit = await service.create(validCreate);

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.b2bUnit.create).toHaveBeenCalledWith({
        data: {
          unitId: 'UNIT-1',
          name: 'Hamburg Plant',
          accountCustomerNumber: 'ACC',
          soldToCustomerNumber: 'ACC',
          billToCustomerNumber: 'BP1',
          payerCustomerNumber: 'ACC',
          isActive: true,
          ...DE,
        },
      });
      expect(db.b2bUnitShipTo.createMany).toHaveBeenCalledWith({
        data: [
          {
            unitId: 'UNIT-1',
            customerNumber: 'SH1',
            accountCustomerNumber: 'ACC',
            isDefault: true,
            ...DE,
          },
          {
            unitId: 'UNIT-1',
            customerNumber: 'SH2',
            accountCustomerNumber: 'ACC',
            isDefault: false,
            ...DE,
          },
        ],
      });
      expect(unit.defaultShipToCustomerNumber).toBe('SH1');
    });

    it('should allow the same customer in several partner functions', async () => {
      await service.create({
        ...validCreate,
        billToCustomerNumber: 'ACC',
        shipToCustomerNumbers: ['ACC'],
        defaultShipToCustomerNumber: 'ACC',
      });

      expect(db.b2bUnit.create).toHaveBeenCalled();
    });

    it('should create an inactive unit when requested', async () => {
      await service.create({ ...validCreate, isActive: false });

      expect(db.b2bUnit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isActive: false }),
      });
    });

    it('should throw ConflictException when the unit ID exists', async () => {
      db.b2bUnit.findUnique.mockReset().mockResolvedValue({ unitId: 'UNIT-1' });

      await expect(service.create(validCreate)).rejects.toThrow(
        new ConflictException('B2B unit UNIT-1 already exists'),
      );
      expectNoWrites();
    });

    it('should map a duplicate key during the insert to 409', async () => {
      db.b2bUnit.create.mockRejectedValue(prismaError('P2002'));

      await expect(service.create(validCreate)).rejects.toThrow(
        new ConflictException('B2B unit UNIT-1 already exists'),
      );
    });

    it('should map a partner removed from the account meanwhile (P2003) to 409', async () => {
      db.b2bUnitShipTo.createMany.mockRejectedValue(prismaError('P2003'));

      await expect(service.create(validCreate)).rejects.toThrow(
        new ConflictException(
          'Customer account ACC was changed at the same time. Please reload and try again.',
        ),
      );
    });

    it.each([
      ['does not exist', 'GHOST', 'accountCustomerNumber GHOST does not exist'],
      [
        'is only a member',
        'SH1',
        'accountCustomerNumber SH1 is not a customer account',
      ],
      [
        'has no account',
        'LONE',
        'accountCustomerNumber LONE is not a customer account',
      ],
      ['is inactive', 'SLEEP', 'accountCustomerNumber SLEEP is inactive'],
    ])('should reject an account that %s', async (_case, account, message) => {
      await expect422(
        service.create({ ...validCreate, accountCustomerNumber: account }),
        [message],
      );
      expectNoWrites();
    });

    it('should report every invalid partner at once', async () => {
      await expect422(
        service.create({
          ...validCreate,
          soldToCustomerNumber: 'GHOST',
          billToCustomerNumber: 'OM',
          payerCustomerNumber: 'OLD',
          shipToCustomerNumbers: ['SH1', 'LONE'],
        }),
        [
          'soldToCustomerNumber GHOST does not exist',
          'billToCustomerNumber OM does not belong to account ACC',
          'payerCustomerNumber OLD is inactive',
          'shipToCustomerNumbers LONE does not belong to account ACC',
        ],
      );
      expectNoWrites();
    });

    it('should reject a default ship-to that is not in the list', async () => {
      await expect422(
        service.create({ ...validCreate, defaultShipToCustomerNumber: 'BP1' }),
        ['defaultShipToCustomerNumber must be one of shipToCustomerNumbers'],
      );
      expectNoWrites();
    });

    it('should reject an inactive ship-to', async () => {
      await expect422(
        service.create({
          ...validCreate,
          shipToCustomerNumbers: ['SH1', 'OLD'],
        }),
        ['shipToCustomerNumbers OLD is inactive'],
      );
    });

    it.each([
      [
        'a combination that is not configured',
        { ...DE, distributionChannel: '20' },
        'salesArea 1000/20/00 does not exist',
      ],
      [
        'an inactive sales organization',
        { ...DE, salesOrganization: '9000' },
        'salesArea 9000/10/00 is inactive',
      ],
    ])('should reject %s', async (_case, salesArea, message) => {
      await expect422(service.create({ ...validCreate, ...salesArea }), [
        message,
      ]);
      expectNoWrites();
    });

    it('should reject partners without an active assignment to the sales area', async () => {
      await expect422(
        service.create({
          ...validCreate,
          billToCustomerNumber: 'PAUSED',
          shipToCustomerNumbers: ['SH1', 'NOAREA'],
        }),
        [
          'billToCustomerNumber PAUSED is inactive in sales area 1000/10/00',
          'shipToCustomerNumbers NOAREA is not assigned to sales area 1000/10/00',
        ],
      );
      expectNoWrites();
    });

    it('should not use partners of another sales area', async () => {
      // Only ACC is assigned to Poland
      await expect422(service.create({ ...validCreate, ...PL }), [
        'billToCustomerNumber BP1 is not assigned to sales area 2000/10/00',
        'shipToCustomerNumbers SH1 is not assigned to sales area 2000/10/00',
        'shipToCustomerNumbers SH2 is not assigned to sales area 2000/10/00',
      ]);
      expectNoWrites();
    });

    it('should create a unit in another sales area with partners assigned there', async () => {
      await service.create({
        ...validCreate,
        ...PL,
        billToCustomerNumber: 'ACC',
        shipToCustomerNumbers: ['ACC'],
        defaultShipToCustomerNumber: 'ACC',
      });

      expect(db.b2bUnit.create).toHaveBeenCalledWith({
        data: expect.objectContaining(PL),
      });
    });

    it('should lock the assignments of all partners with a parameterized query', async () => {
      await service.create(validCreate);

      const call = db.$queryRaw.mock.calls.find(([strings]) =>
        (strings as TemplateStringsArray).join('?').includes('FOR SHARE'),
      ) as [TemplateStringsArray, ...unknown[]];
      expect(call[0].join('?')).toMatch(
        /FROM customer_sales_areas\s+WHERE customer_number = ANY\(\?\)/,
      );
      expect(call.slice(1)).toEqual([
        ['ACC', 'BP1', 'SH1', 'SH2'],
        '1000',
        '10',
        '00',
      ]);
      expect(db.$queryRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
        db.b2bUnit.create.mock.invocationCallOrder[0],
      );
    });

    it('should fail and roll back if the default rule is broken', async () => {
      db.b2bUnitShipTo.count.mockResolvedValue(0);

      await expect(service.create(validCreate)).rejects.toThrow(
        'B2B unit UNIT-1 would have 0 default ship-tos instead of 1',
      );
    });
  });

  describe('update', () => {
    beforeEach(() => {
      // Used for the check inside the transaction and the reload after it
      db.b2bUnit.findUnique.mockResolvedValue(unitRecord());
    });

    it('should throw NotFoundException for an unknown unit', async () => {
      // The lock finds no row
      db.$queryRaw.mockResolvedValue([]);

      await expect(service.update('NOPE', { name: 'X' })).rejects.toThrow(
        new NotFoundException('B2B unit NOPE not found'),
      );
      expectNoWrites();
    });

    it('should lock the unit row with a parameterized query before reading it', async () => {
      await service.update('UNIT-1', { name: 'Renamed' });

      const [strings, ...values] = db.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      expect(strings.join('?')).toMatch(
        /SELECT unit_id FROM b2b_units WHERE unit_id = \? FOR UPDATE/,
      );
      expect(values).toEqual(['UNIT-1']);
      expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        db.b2bUnit.findUnique.mock.invocationCallOrder[0],
      );
    });

    it('should update the name without touching the ship-tos', async () => {
      await service.update('UNIT-1', { name: 'Renamed' });

      expect(db.b2bUnit.update).toHaveBeenCalledWith({
        where: { unitId: 'UNIT-1' },
        data: {
          name: 'Renamed',
          billToCustomerNumber: undefined,
          payerCustomerNumber: undefined,
          isActive: undefined,
        },
      });
      expect(db.b2bUnitShipTo.createMany).not.toHaveBeenCalled();
      expect(db.b2bUnitShipTo.deleteMany).not.toHaveBeenCalled();
      expect(db.b2bUnitShipTo.update).not.toHaveBeenCalled();
    });

    it('should keep a partner that became inactive after it was assigned', async () => {
      db.b2bUnit.findUnique.mockResolvedValue(unitRecord({ billTo: 'OLD' }));

      await expect(
        service.update('UNIT-1', { name: 'Renamed', isActive: false }),
      ).resolves.toBeDefined();
    });

    it('should reject a newly assigned inactive Bill-to', async () => {
      await expect422(
        service.update('UNIT-1', { billToCustomerNumber: 'OLD' }),
        ['billToCustomerNumber OLD is inactive'],
      );
      expectNoWrites();
    });

    it('should reject a Payer from another account', async () => {
      await expect422(service.update('UNIT-1', { payerCustomerNumber: 'OM' }), [
        'payerCustomerNumber OM does not belong to account ACC',
      ]);
    });

    it('should replace ship-tos and switch the default in a safe order', async () => {
      // Before: SH1 (default), SH2. After: SH2 (default), ACC.
      await service.update('UNIT-1', {
        shipToCustomerNumbers: ['SH2', 'ACC'],
        defaultShipToCustomerNumber: 'SH2',
      });

      expect(db.b2bUnitShipTo.deleteMany).toHaveBeenCalledWith({
        where: { unitId: 'UNIT-1', customerNumber: { in: ['SH1'] } },
      });
      expect(db.b2bUnitShipTo.createMany).toHaveBeenCalledWith({
        data: [
          {
            unitId: 'UNIT-1',
            customerNumber: 'ACC',
            accountCustomerNumber: 'ACC',
            isDefault: false,
            ...DE,
          },
        ],
      });
      expect(db.b2bUnitShipTo.update).toHaveBeenCalledTimes(1);
      expect(db.b2bUnitShipTo.update).toHaveBeenCalledWith({
        where: {
          unitId_customerNumber: { unitId: 'UNIT-1', customerNumber: 'SH2' },
        },
        data: { isDefault: true },
      });
      // remove -> add -> set new default, then check
      const order = [
        db.b2bUnitShipTo.deleteMany.mock.invocationCallOrder[0],
        db.b2bUnitShipTo.createMany.mock.invocationCallOrder[0],
        db.b2bUnitShipTo.update.mock.invocationCallOrder[0],
        db.b2bUnitShipTo.count.mock.invocationCallOrder[0],
      ];
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('should unset the old default before setting the new one', async () => {
      await service.update('UNIT-1', { defaultShipToCustomerNumber: 'SH2' });

      expect(db.b2bUnitShipTo.update.mock.calls).toEqual([
        [
          {
            where: {
              unitId_customerNumber: {
                unitId: 'UNIT-1',
                customerNumber: 'SH1',
              },
            },
            data: { isDefault: false },
          },
        ],
        [
          {
            where: {
              unitId_customerNumber: {
                unitId: 'UNIT-1',
                customerNumber: 'SH2',
              },
            },
            data: { isDefault: true },
          },
        ],
      ]);
    });

    it('should reject removing the default without choosing a new one', async () => {
      await expect422(
        service.update('UNIT-1', { shipToCustomerNumbers: ['SH2'] }),
        ['defaultShipToCustomerNumber must be one of shipToCustomerNumbers'],
      );
      expectNoWrites();
    });

    it('should reject an inactive customer as new default', async () => {
      db.b2bUnit.findUnique.mockResolvedValue(
        unitRecord({
          shipTos: [
            { customerNumber: 'SH1', isDefault: true },
            { customerNumber: 'OLD', isDefault: false },
          ],
        }),
      );

      await expect422(
        service.update('UNIT-1', { defaultShipToCustomerNumber: 'OLD' }),
        ['defaultShipToCustomerNumber OLD is inactive'],
      );
    });

    it('should keep an existing inactive ship-to when other ship-tos change', async () => {
      db.b2bUnit.findUnique.mockResolvedValue(
        unitRecord({
          shipTos: [
            { customerNumber: 'SH1', isDefault: true },
            { customerNumber: 'OLD', isDefault: false },
          ],
        }),
      );

      await expect(
        service.update('UNIT-1', {
          shipToCustomerNumbers: ['SH1', 'OLD', 'SH2'],
        }),
      ).resolves.toBeDefined();
    });

    it('should reject a new ship-to from another account', async () => {
      await expect422(
        service.update('UNIT-1', { shipToCustomerNumbers: ['SH1', 'OM'] }),
        ['shipToCustomerNumbers OM does not belong to account ACC'],
      );
    });

    it('should reject a new ship-to that is not assigned to the sales area', async () => {
      await expect422(
        service.update('UNIT-1', { shipToCustomerNumbers: ['SH1', 'NOAREA'] }),
        [
          'shipToCustomerNumbers NOAREA is not assigned to sales area 1000/10/00',
        ],
      );
      expectNoWrites();
    });

    it('should check new partners against the sales area of the unit', async () => {
      db.b2bUnit.findUnique.mockResolvedValue(
        unitRecord({
          salesArea: PL,
          billTo: 'ACC',
          shipTos: [{ customerNumber: 'ACC', isDefault: true }],
        }),
      );

      await expect422(
        service.update('UNIT-1', { billToCustomerNumber: 'BP1' }),
        ['billToCustomerNumber BP1 is not assigned to sales area 2000/10/00'],
      );
    });

    it('should not check kept partners of an active unit again', async () => {
      db.b2bUnit.findUnique.mockResolvedValue(unitRecord({ billTo: 'PAUSED' }));

      await expect(
        service.update('UNIT-1', { name: 'Renamed' }),
      ).resolves.toBeDefined();
    });

    it('should reject reactivating a unit whose partner is inactive in the sales area', async () => {
      db.b2bUnit.findUnique.mockResolvedValue(
        unitRecord({ isActive: false, billTo: 'PAUSED' }),
      );

      await expect422(service.update('UNIT-1', { isActive: true }), [
        'billToCustomerNumber PAUSED is inactive in sales area 1000/10/00',
      ]);
      expectNoWrites();
    });

    it('should reject reactivating a unit in an inactive sales area', async () => {
      db.b2bUnit.findUnique.mockResolvedValue(
        unitRecord({
          isActive: false,
          salesArea: { ...DE, salesOrganization: '9000' },
        }),
      );

      await expect422(service.update('UNIT-1', { isActive: true }), [
        'salesArea 9000/10/00 is inactive',
        'soldToCustomerNumber ACC is not assigned to sales area 9000/10/00',
        'billToCustomerNumber BP1 is not assigned to sales area 9000/10/00',
        'payerCustomerNumber ACC is not assigned to sales area 9000/10/00',
        'shipToCustomerNumbers SH1 is not assigned to sales area 9000/10/00',
        'shipToCustomerNumbers SH2 is not assigned to sales area 9000/10/00',
      ]);
    });

    it('should reactivate a unit whose partners are all active in the sales area', async () => {
      db.b2bUnit.findUnique.mockResolvedValue(unitRecord({ isActive: false }));

      await service.update('UNIT-1', { isActive: true });

      expect(db.b2bUnit.update).toHaveBeenCalledWith({
        where: { unitId: 'UNIT-1' },
        data: expect.objectContaining({ isActive: true }),
      });
    });

    it('should allow a kept partner whose customer became inactive on reactivation', async () => {
      // Only the sales area assignment is required again, as before 9C-A
      db.b2bUnit.findUnique.mockResolvedValue(
        unitRecord({ isActive: false, billTo: 'OLD' }),
      );

      await expect(
        service.update('UNIT-1', { isActive: true }),
      ).resolves.toBeDefined();
    });

    it('should fail and roll back if the default rule is broken', async () => {
      db.b2bUnitShipTo.count.mockResolvedValue(2);

      await expect(
        service.update('UNIT-1', { defaultShipToCustomerNumber: 'SH2' }),
      ).rejects.toThrow(
        'B2B unit UNIT-1 would have 2 default ship-tos instead of 1',
      );
    });

    it.each([
      ['a second default (P2002)', 'P2002'],
      ['a row that disappeared (P2025)', 'P2025'],
      ['a membership removed meanwhile (P2003)', 'P2003'],
    ])('should map %s during the update to 409', async (_case, code) => {
      db.b2bUnitShipTo.update.mockRejectedValue(prismaError(code));

      await expect(
        service.update('UNIT-1', { defaultShipToCustomerNumber: 'SH2' }),
      ).rejects.toThrow(
        new ConflictException(
          'B2B unit UNIT-1 was changed at the same time. Please reload and try again.',
        ),
      );
    });

    it('should pass on other database errors unchanged', async () => {
      const error = prismaError('P1001');
      db.b2bUnitShipTo.update.mockRejectedValue(error);

      await expect(
        service.update('UNIT-1', { defaultShipToCustomerNumber: 'SH2' }),
      ).rejects.toBe(error);
    });
  });
});
