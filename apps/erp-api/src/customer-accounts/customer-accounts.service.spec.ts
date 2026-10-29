import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';

type CustomerRow = { customerNumber: string; name: string; isActive: boolean };
type MemberRow = {
  customerNumber: string;
  accountCustomerNumber: string;
  accountOwnerRef: string;
};

/**
 * A tiny in-memory stand-in for the Prisma calls the service uses,
 * so the tests can check the resulting state, not only the calls.
 */
type UnitUsage = {
  unitId: string;
  soldToCustomerNumber: string;
  billToCustomerNumber: string;
  payerCustomerNumber: string;
  shipTos: { customerNumber: string }[];
};

function createFakeDb(customers: CustomerRow[], members: MemberRow[]) {
  const state = {
    customers,
    members: [...members],
    // B2B units that use members as partners
    units: [] as UnitUsage[],
  };
  const withCustomer = (row: MemberRow) => ({
    ...row,
    customer: state.customers.find(
      (c) => c.customerNumber === row.customerNumber,
    )!,
  });
  const withMembership = (customer: CustomerRow) => ({
    ...customer,
    accountMembership:
      state.members.find((m) => m.customerNumber === customer.customerNumber) ??
      null,
  });

  const delegates = {
    // Row lock on the owner's customer row: SELECT ... FOR UPDATE
    $queryRaw: jest.fn(
      (_strings: TemplateStringsArray, customerNumber: string) =>
        state.customers
          .filter((c) => c.customerNumber === customerNumber)
          .map((c) => ({ customer_number: c.customerNumber })),
    ),
    customer: {
      findUnique: jest.fn(
        ({ where }: { where: { customerNumber: string } }) => {
          const customer = state.customers.find(
            (c) => c.customerNumber === where.customerNumber,
          );
          return customer ? withMembership(customer) : null;
        },
      ),
      findMany: jest.fn(
        ({ where }: { where: { customerNumber: { in: string[] } } }) =>
          state.customers
            .filter((c) => where.customerNumber.in.includes(c.customerNumber))
            .map(withMembership),
      ),
    },
    customerAccountMember: {
      findMany: jest.fn(
        ({
          where,
        }: {
          where?: {
            accountCustomerNumber?: string;
            NOT?: { customerNumber: string };
          };
        } = {}) =>
          state.members
            .filter(
              (m) =>
                (!where?.accountCustomerNumber ||
                  m.accountCustomerNumber === where.accountCustomerNumber) &&
                m.customerNumber !== where?.NOT?.customerNumber,
            )
            .sort((a, b) => a.customerNumber.localeCompare(b.customerNumber))
            .map(withCustomer),
      ),
      create: jest.fn(({ data }: { data: MemberRow }) => {
        state.members.push(data);
        return data;
      }),
      createMany: jest.fn(({ data }: { data: MemberRow[] }) => {
        state.members.push(...data);
        return { count: data.length };
      }),
      deleteMany: jest.fn(
        ({ where }: { where: { customerNumber: { in: string[] } } }) => {
          state.members = state.members.filter(
            (m) => !where.customerNumber.in.includes(m.customerNumber),
          );
          return { count: 0 };
        },
      ),
    },
    b2bUnit: {
      findMany: jest.fn(() => state.units),
    },
  };
  // The transaction callback gets the same delegates as the client
  const $transaction = jest.fn(
    (callback: (tx: typeof delegates) => unknown): unknown =>
      callback(delegates),
  );
  return { state, $transaction, ...delegates };
}

const owner = { customerNumber: 'ACC', name: 'Account Owner', isActive: true };
const member1 = { customerNumber: 'M1', name: 'Member One', isActive: true };
const member2 = { customerNumber: 'M2', name: 'Member Two', isActive: true };
const inactive = { customerNumber: 'OLD', name: 'Old Member', isActive: false };
const otherOwner = {
  customerNumber: 'OTHER',
  name: 'Other Owner',
  isActive: true,
};
const otherMember = {
  customerNumber: 'OM',
  name: 'Other Member',
  isActive: true,
};

const ownerRow = (n: string) => ({
  customerNumber: n,
  accountCustomerNumber: n,
  accountOwnerRef: n,
});
const memberRow = (n: string, account: string) => ({
  customerNumber: n,
  accountCustomerNumber: account,
  accountOwnerRef: account,
});

const allCustomers = [
  owner,
  member1,
  member2,
  inactive,
  otherOwner,
  otherMember,
];

describe('CustomerAccountsService', () => {
  let service: CustomerAccountsService;
  let db: ReturnType<typeof createFakeDb>;

  async function setup(members: MemberRow[], customers = allCustomers) {
    db = createFakeDb(customers, members);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerAccountsService,
        { provide: PrismaService, useValue: db },
      ],
    }).compile();
    service = module.get(CustomerAccountsService);
  }

  const existingAccounts = () => [
    ownerRow('ACC'),
    memberRow('M1', 'ACC'),
    memberRow('OLD', 'ACC'),
    ownerRow('OTHER'),
    memberRow('OM', 'OTHER'),
  ];

  describe('findAll and findOne', () => {
    it('should list accounts with their members, without the owner as member', async () => {
      await setup(existingAccounts());

      await expect(service.findAll()).resolves.toEqual([
        {
          accountCustomerNumber: 'ACC',
          name: 'Account Owner',
          isActive: true,
          members: [
            { customerNumber: 'M1', name: 'Member One', isActive: true },
            { customerNumber: 'OLD', name: 'Old Member', isActive: false },
          ],
        },
        {
          accountCustomerNumber: 'OTHER',
          name: 'Other Owner',
          isActive: true,
          members: [
            { customerNumber: 'OM', name: 'Other Member', isActive: true },
          ],
        },
      ]);
    });

    it('should return one account', async () => {
      await setup(existingAccounts());

      const account = await service.findOne('OTHER');

      expect(account.members.map((m) => m.customerNumber)).toEqual(['OM']);
    });

    it('should throw NotFoundException for a customer that owns no account', async () => {
      await setup(existingAccounts());

      await expect(service.findOne('M1')).rejects.toThrow(
        new NotFoundException('Customer account M1 not found'),
      );
    });
  });

  describe('replaceMembers', () => {
    it('should create a new account with its owner row and members', async () => {
      await setup([]);

      const account = await service.replaceMembers('ACC', {
        memberCustomerNumbers: ['M1', 'M2'],
      });

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.state.members).toEqual([
        ownerRow('ACC'),
        memberRow('M1', 'ACC'),
        memberRow('M2', 'ACC'),
      ]);
      expect(account.members.map((m) => m.customerNumber)).toEqual([
        'M1',
        'M2',
      ]);
    });

    it('should create an account without members', async () => {
      await setup([]);

      await service.replaceMembers('ACC', { memberCustomerNumbers: [] });

      expect(db.state.members).toEqual([ownerRow('ACC')]);
    });

    it('should add and remove members of an existing account', async () => {
      await setup(existingAccounts());

      await service.replaceMembers('ACC', {
        memberCustomerNumbers: ['M2', 'OLD'],
      });

      const accRows = db.state.members.filter(
        (m) => m.accountCustomerNumber === 'ACC',
      );
      expect(accRows.map((m) => m.customerNumber).sort()).toEqual([
        'ACC',
        'M2',
        'OLD',
      ]);
      expect(db.customerAccountMember.create).not.toHaveBeenCalled();
    });

    it('should keep an existing inactive member', async () => {
      await setup(existingAccounts());

      await expect(
        service.replaceMembers('ACC', { memberCustomerNumbers: ['M1', 'OLD'] }),
      ).resolves.toBeDefined();
    });

    it('should throw NotFoundException for an unknown owner customer', async () => {
      await setup([]);

      await expect(
        service.replaceMembers('NOPE', { memberCustomerNumbers: [] }),
      ).rejects.toThrow(new NotFoundException('Customer NOPE not found'));
      expect(db.customer.findUnique).not.toHaveBeenCalled();
    });

    it('should lock the owner row with a parameterized query before reading memberships', async () => {
      // No account yet: the lock must still work on the customer row
      await setup([]);

      await service.replaceMembers('ACC', { memberCustomerNumbers: ['M1'] });

      const [strings, ...values] = db.$queryRaw.mock.calls[0];
      expect(strings.join('?')).toMatch(
        /SELECT customer_number FROM customers\s+WHERE customer_number = \? FOR UPDATE/,
      );
      expect(values).toEqual(['ACC']);
      const lockOrder = db.$queryRaw.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(
        db.customer.findUnique.mock.invocationCallOrder[0],
      );
      expect(lockOrder).toBeLessThan(
        db.customerAccountMember.findMany.mock.invocationCallOrder[0],
      );
    });

    it.each([
      [
        'the owner is a member of another account',
        'OM',
        [],
        'accountCustomerNumber OM is a member of account OTHER and cannot own an account',
      ],
      [
        'the list contains the owner',
        'ACC',
        ['ACC'],
        'memberCustomerNumbers must not contain the account owner ACC',
      ],
      [
        'a new member does not exist',
        'ACC',
        ['M1', 'GHOST'],
        'memberCustomerNumbers GHOST does not exist',
      ],
      [
        'a new member owns another account',
        'ACC',
        ['M1', 'OTHER'],
        'memberCustomerNumbers OTHER owns its own account and cannot be a member of another account',
      ],
      [
        'a new member belongs to another account',
        'ACC',
        ['M1', 'OM'],
        'memberCustomerNumbers OM is already a member of account OTHER',
      ],
    ])(
      'should reject with 422 when %s',
      async (_case, accountNumber, list, message) => {
        await setup(existingAccounts());
        const before = [...db.state.members];

        await expect(
          service.replaceMembers(accountNumber, {
            memberCustomerNumbers: list,
          }),
        ).rejects.toThrow(new UnprocessableEntityException([message]));
        expect(db.state.members).toEqual(before);
      },
    );

    it('should reject a new inactive member with 422', async () => {
      await setup([ownerRow('ACC')]);

      await expect(
        service.replaceMembers('ACC', { memberCustomerNumbers: ['OLD'] }),
      ).rejects.toThrow(
        new UnprocessableEntityException([
          'memberCustomerNumbers OLD is inactive',
        ]),
      );
    });

    it('should not create an account for an inactive owner', async () => {
      await setup([], [{ ...owner, isActive: false }, member1]);

      await expect(
        service.replaceMembers('ACC', { memberCustomerNumbers: [] }),
      ).rejects.toThrow(
        new UnprocessableEntityException([
          'accountCustomerNumber ACC is inactive',
        ]),
      );
      expect(db.state.members).toEqual([]);
    });

    it('should report all violations at once', async () => {
      await setup(existingAccounts());

      const error = await service
        .replaceMembers('ACC', { memberCustomerNumbers: ['GHOST', 'OM'] })
        .catch((e: unknown) => e);

      expect(
        (error as UnprocessableEntityException).getResponse(),
      ).toMatchObject({
        statusCode: 422,
        message: [
          'memberCustomerNumbers GHOST does not exist',
          'memberCustomerNumbers OM is already a member of account OTHER',
        ],
      });
    });

    it('should reject removing a member that is still used by a B2B unit', async () => {
      await setup(existingAccounts());
      db.state.units = [
        {
          unitId: 'UNIT-1',
          soldToCustomerNumber: 'ACC',
          billToCustomerNumber: 'M1',
          payerCustomerNumber: 'ACC',
          shipTos: [{ customerNumber: 'ACC' }],
        },
      ];

      await expect(
        service.replaceMembers('ACC', { memberCustomerNumbers: ['OLD'] }),
      ).rejects.toThrow(
        new ConflictException([
          'memberCustomerNumbers M1 is still used as a partner in B2B unit UNIT-1',
        ]),
      );
      expect(db.customerAccountMember.deleteMany).not.toHaveBeenCalled();
    });

    it.each([['P2002'], ['P2003'], ['P2025']])(
      'should map database conflict %s during the transaction to 409',
      async (code) => {
        await setup(existingAccounts());
        db.customerAccountMember.createMany.mockImplementation(() => {
          throw new Prisma.PrismaClientKnownRequestError('conflict', {
            code,
            clientVersion: '7.10.1',
          });
        });

        await expect(
          service.replaceMembers('ACC', {
            memberCustomerNumbers: ['M1', 'M2'],
          }),
        ).rejects.toThrow(
          new ConflictException(
            'The account was changed at the same time. Please reload and try again.',
          ),
        );
      },
    );
  });
});
