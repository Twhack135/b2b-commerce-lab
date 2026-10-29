import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { toPartnerSummary } from '../common/partner-summary';
import { Prisma } from '../generated/prisma/client';
import {
  FOREIGN_KEY_FAILED,
  isPrismaError,
  RECORD_NOT_FOUND,
  UNIQUE_CONSTRAINT_FAILED,
} from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccount } from './customer-account.interface';
import { ReplaceAccountMembersDto } from './dto/replace-account-members.dto';

const WITH_CUSTOMER = { customer: true } as const;

type MembershipWithCustomer = Prisma.CustomerAccountMemberGetPayload<{
  include: typeof WITH_CUSTOMER;
}>;

@Injectable()
export class CustomerAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<CustomerAccount[]> {
    const rows = await this.prisma.customerAccountMember.findMany({
      include: WITH_CUSTOMER,
      orderBy: { customerNumber: 'asc' },
    });
    const owners = rows.filter(isOwnerRow);
    return owners.map((owner) =>
      toCustomerAccount(
        owner,
        rows.filter(
          (row) =>
            row.accountCustomerNumber === owner.customerNumber &&
            !isOwnerRow(row),
        ),
      ),
    );
  }

  async findOne(accountCustomerNumber: string): Promise<CustomerAccount> {
    const account = await loadAccount(this.prisma, accountCustomerNumber);
    if (!account) {
      throw new NotFoundException(
        `Customer account ${accountCustomerNumber} not found`,
      );
    }
    return account;
  }

  /**
   * Replaces the member list of an account in one transaction.
   * Creates the account (the owner row) if it does not exist yet.
   * The transaction only checks and writes; the result is loaded after the
   * commit (see B2bUnitsService for the reason).
   */
  async replaceMembers(
    accountCustomerNumber: string,
    dto: ReplaceAccountMembersDto,
  ): Promise<CustomerAccount> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Lock the owner's customer row first (on the transaction's
        // connection). It exists even before the account is created, so a
        // second replacement of the same account waits here and then works on
        // the committed list instead of merging with it.
        const locked = await tx.$queryRaw<{ customer_number: string }[]>`
          SELECT customer_number FROM customers
          WHERE customer_number = ${accountCustomerNumber} FOR UPDATE`;
        if (locked.length === 0) {
          throw new NotFoundException(
            `Customer ${accountCustomerNumber} not found`,
          );
        }

        const owner = await tx.customer.findUnique({
          where: { customerNumber: accountCustomerNumber },
          include: { accountMembership: true },
        });
        if (!owner) {
          throw new NotFoundException(
            `Customer ${accountCustomerNumber} not found`,
          );
        }

        const ownerMembership = owner.accountMembership;
        const isNewAccount = !ownerMembership;
        const violations: string[] = [];

        if (
          ownerMembership &&
          ownerMembership.accountCustomerNumber !== accountCustomerNumber
        ) {
          violations.push(
            `accountCustomerNumber ${accountCustomerNumber} is a member of account ${ownerMembership.accountCustomerNumber} and cannot own an account`,
          );
        }
        if (isNewAccount && !owner.isActive) {
          violations.push(
            `accountCustomerNumber ${accountCustomerNumber} is inactive`,
          );
        }

        const next = dto.memberCustomerNumbers;
        if (next.includes(accountCustomerNumber)) {
          violations.push(
            `memberCustomerNumbers must not contain the account owner ${accountCustomerNumber}`,
          );
        }

        const currentRows = await tx.customerAccountMember.findMany({
          where: {
            accountCustomerNumber,
            NOT: { customerNumber: accountCustomerNumber },
          },
        });
        const current = currentRows.map((row) => row.customerNumber);
        const added = next.filter(
          (number) =>
            !current.includes(number) && number !== accountCustomerNumber,
        );
        const removed = current.filter((number) => !next.includes(number));

        // New members must exist, be active and not belong to another account
        const addedCustomers = await tx.customer.findMany({
          where: { customerNumber: { in: added } },
          include: { accountMembership: true },
        });
        for (const number of added) {
          const customer = addedCustomers.find(
            (c) => c.customerNumber === number,
          );
          if (!customer) {
            violations.push(`memberCustomerNumbers ${number} does not exist`);
          } else if (!customer.isActive) {
            violations.push(`memberCustomerNumbers ${number} is inactive`);
          } else if (customer.accountMembership) {
            const other = customer.accountMembership;
            violations.push(
              other.accountCustomerNumber === other.customerNumber
                ? `memberCustomerNumbers ${number} owns its own account and cannot be a member of another account`
                : `memberCustomerNumbers ${number} is already a member of account ${other.accountCustomerNumber}`,
            );
          }
        }

        if (violations.length > 0) {
          throw new UnprocessableEntityException(violations);
        }

        // Members still used as partners must not be removed
        if (removed.length > 0) {
          const usage = await findPartnerUsage(
            tx,
            accountCustomerNumber,
            removed,
          );
          if (usage.length > 0) {
            throw new ConflictException(usage);
          }
        }

        if (isNewAccount) {
          await tx.customerAccountMember.create({
            data: ownerRow(accountCustomerNumber),
          });
        }
        if (removed.length > 0) {
          await tx.customerAccountMember.deleteMany({
            where: { accountCustomerNumber, customerNumber: { in: removed } },
          });
        }
        if (added.length > 0) {
          await tx.customerAccountMember.createMany({
            data: added.map((number) =>
              memberRow(number, accountCustomerNumber),
            ),
          });
        }
      });
    } catch (error) {
      // A missing owner was already reported as 404 above. The database can
      // only reject a checked change if other data changed at the same time,
      // e.g. another account claimed the same new member (P2002), a member
      // became a unit partner (P2003) or a row disappeared (P2025).
      if (
        isPrismaError(error, UNIQUE_CONSTRAINT_FAILED) ||
        isPrismaError(error, FOREIGN_KEY_FAILED) ||
        isPrismaError(error, RECORD_NOT_FOUND)
      ) {
        throw new ConflictException(
          'The account was changed at the same time. Please reload and try again.',
        );
      }
      throw error;
    }
    return this.findOne(accountCustomerNumber);
  }
}

type Db = Pick<PrismaService, 'customerAccountMember' | 'b2bUnit'>;

function isOwnerRow(row: {
  customerNumber: string;
  accountCustomerNumber: string;
}) {
  return row.customerNumber === row.accountCustomerNumber;
}

/** Row that marks a customer as account owner (points to itself) */
export function ownerRow(customerNumber: string) {
  return memberRow(customerNumber, customerNumber);
}

export function memberRow(
  customerNumber: string,
  accountCustomerNumber: string,
) {
  return {
    customerNumber,
    accountCustomerNumber,
    accountOwnerRef: accountCustomerNumber,
  };
}

async function loadAccount(
  db: Db,
  accountCustomerNumber: string,
): Promise<CustomerAccount | null> {
  const rows = await db.customerAccountMember.findMany({
    where: { accountCustomerNumber },
    include: WITH_CUSTOMER,
    orderBy: { customerNumber: 'asc' },
  });
  const owner = rows.find(isOwnerRow);
  if (!owner) return null;
  return toCustomerAccount(
    owner,
    rows.filter((row) => !isOwnerRow(row)),
  );
}

/** Messages for members that are still used as partners in B2B units */
async function findPartnerUsage(
  db: Db,
  accountCustomerNumber: string,
  customerNumbers: string[],
): Promise<string[]> {
  const units = await db.b2bUnit.findMany({
    where: {
      accountCustomerNumber,
      OR: [
        { soldToCustomerNumber: { in: customerNumbers } },
        { billToCustomerNumber: { in: customerNumbers } },
        { payerCustomerNumber: { in: customerNumbers } },
        { shipTos: { some: { customerNumber: { in: customerNumbers } } } },
      ],
    },
    include: { shipTos: true },
    orderBy: { unitId: 'asc' },
  });

  return customerNumbers.flatMap((number) => {
    const unitIds = units
      .filter(
        (unit) =>
          unit.soldToCustomerNumber === number ||
          unit.billToCustomerNumber === number ||
          unit.payerCustomerNumber === number ||
          unit.shipTos.some((shipTo) => shipTo.customerNumber === number),
      )
      .map((unit) => unit.unitId);
    return unitIds.length > 0
      ? [
          `memberCustomerNumbers ${number} is still used as a partner in B2B unit ${unitIds.join(', ')}`,
        ]
      : [];
  });
}

function toCustomerAccount(
  owner: MembershipWithCustomer,
  members: MembershipWithCustomer[],
): CustomerAccount {
  return {
    accountCustomerNumber: owner.customerNumber,
    name: owner.customer.name,
    isActive: owner.customer.isActive,
    members: members.map((member) => toPartnerSummary(member.customer)),
  };
}
