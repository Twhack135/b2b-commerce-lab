import { Injectable } from '@nestjs/common';
import { ShopUser as ShopUserRecord } from '../../generated/prisma/client';
import {
  FOREIGN_KEY_FAILED,
  isPrismaError,
  UNIQUE_CONSTRAINT_FAILED,
} from '../../prisma/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AuthorizedUnit,
  ShopUser,
  ShopUserStatus,
  UnitPurpose,
} from './shop-user.interface';
import {
  isUuid,
  normalizeDisplayName,
  normalizeEmail,
  ShopUserRuleError,
} from './shop-user-rules';

/**
 * Shop users and the B2B units they may act for (docs/adr/0004). Internal
 * domain service: it has no endpoints and no user context. Every rule here
 * is also enforced by the database, above all that a user can only be
 * assigned units of their own customer account.
 *
 * Authorization needs an active user of an active account (owner customer
 * active) and an assignment to the unit; ordering also an active unit.
 */
@Injectable()
export class ShopUsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** A new, active BUYER of an active customer account */
  async createUser(input: {
    accountCustomerNumber: string;
    email: string;
    displayName: string;
  }): Promise<ShopUser> {
    const email = normalizeEmail(input.email);
    if (!email) throw new ShopUserRuleError('EMAIL_INVALID');
    const displayName = normalizeDisplayName(input.displayName);
    if (!displayName) throw new ShopUserRuleError('DISPLAY_NAME_INVALID');

    // An account is the owner row of customer_account_members; a member
    // customer is no account of its own
    const account = await this.prisma.customerAccountMember.findUnique({
      where: { customerNumber: input.accountCustomerNumber },
      include: { customer: { select: { isActive: true } } },
    });
    if (!account || account.accountCustomerNumber !== account.customerNumber) {
      throw new ShopUserRuleError('ACCOUNT_NOT_FOUND');
    }
    if (!account.customer.isActive) {
      throw new ShopUserRuleError('ACCOUNT_INACTIVE');
    }

    try {
      const user = await this.prisma.shopUser.create({
        data: {
          accountCustomerNumber: account.accountCustomerNumber,
          accountOwnerRef: account.accountCustomerNumber,
          email,
          displayName,
        },
      });
      return toShopUser(user);
    } catch (error) {
      if (isPrismaError(error, UNIQUE_CONSTRAINT_FAILED)) {
        throw new ShopUserRuleError('EMAIL_TAKEN');
      }
      throw error;
    }
  }

  async findUser(userId: string): Promise<ShopUser | null> {
    if (!isUuid(userId)) return null;
    const user = await this.prisma.shopUser.findUnique({
      where: { id: userId },
    });
    return user ? toShopUser(user) : null;
  }

  /** The user with this address, in any spelling (see normalizeEmail) */
  async findUserByEmail(rawEmail: string): Promise<ShopUser | null> {
    const email = normalizeEmail(rawEmail);
    if (!email) return null;
    const user = await this.prisma.shopUser.findUnique({ where: { email } });
    return user ? toShopUser(user) : null;
  }

  /**
   * Disables or enables a user. A disabled user keeps the unit assignments
   * but is authorized for nothing until enabled again.
   */
  async setStatus(userId: string, status: ShopUserStatus): Promise<ShopUser> {
    if (!isUuid(userId)) throw new ShopUserRuleError('USER_NOT_FOUND');
    const { count } = await this.prisma.shopUser.updateMany({
      where: { id: userId },
      data: { status },
    });
    if (count === 0) throw new ShopUserRuleError('USER_NOT_FOUND');
    return (await this.findUser(userId))!;
  }

  /**
   * Authorizes the user for an active unit of their own account. Assigning
   * the same unit again changes nothing (`created` false).
   */
  async assignUnit(
    userId: string,
    unitId: string,
  ): Promise<{ created: boolean }> {
    const user = await this.findUser(userId);
    if (!user) throw new ShopUserRuleError('USER_NOT_FOUND');
    const unit = await this.prisma.b2bUnit.findUnique({
      where: { unitId },
      select: { accountCustomerNumber: true, isActive: true },
    });
    if (!unit) throw new ShopUserRuleError('UNIT_NOT_FOUND');
    if (unit.accountCustomerNumber !== user.accountCustomerNumber) {
      throw new ShopUserRuleError('UNIT_OF_OTHER_ACCOUNT');
    }
    if (!unit.isActive) throw new ShopUserRuleError('UNIT_INACTIVE');

    try {
      const { count } = await this.prisma.shopUserUnit.createMany({
        data: [
          {
            userId,
            unitId,
            accountCustomerNumber: user.accountCustomerNumber,
          },
        ],
        // A concurrent assignment of the same unit is not an error either
        skipDuplicates: true,
      });
      return { created: count === 1 };
    } catch (error) {
      // The database rejects anything outside the user's account; the
      // checks above make this reachable only through concurrent changes
      if (isPrismaError(error, FOREIGN_KEY_FAILED)) {
        throw new ShopUserRuleError('UNIT_OF_OTHER_ACCOUNT');
      }
      throw error;
    }
  }

  /**
   * Withdraws the authorization; the unit, its partners and Ship-tos and
   * all orders stay as they are. false if there was no assignment.
   */
  async unassignUnit(userId: string, unitId: string): Promise<boolean> {
    if (!isUuid(userId)) return false;
    const { count } = await this.prisma.shopUserUnit.deleteMany({
      where: { userId, unitId },
    });
    return count === 1;
  }

  /**
   * The units the user is authorized for, by unit ID. Empty for an unknown
   * or disabled user and for a user of an inactive account.
   */
  async authorizedUnits(userId: string): Promise<AuthorizedUnit[]> {
    if (!isUuid(userId)) return [];
    const user = await this.prisma.shopUser.findUnique({
      where: { id: userId },
      select: {
        status: true,
        account: { select: { customer: { select: { isActive: true } } } },
        units: {
          orderBy: { unitId: 'asc' },
          select: {
            unit: {
              select: {
                unitId: true,
                name: true,
                isActive: true,
                salesOrganization: true,
                distributionChannel: true,
                division: true,
              },
            },
          },
        },
      },
    });
    if (!user || !isUsable(user)) return [];
    return user.units.map(({ unit }) => ({
      unitId: unit.unitId,
      name: unit.name,
      salesArea: {
        salesOrganization: unit.salesOrganization,
        distributionChannel: unit.distributionChannel,
        division: unit.division,
      },
      canOrder: unit.isActive,
    }));
  }

  /** True if the user may use the unit for this purpose (see UnitPurpose) */
  async isAuthorizedForUnit(
    userId: string,
    unitId: string,
    purpose: UnitPurpose,
  ): Promise<boolean> {
    if (!isUuid(userId)) return false;
    const assignment = await this.prisma.shopUserUnit.findUnique({
      where: { userId_unitId: { userId, unitId } },
      select: {
        unit: { select: { isActive: true } },
        user: {
          select: {
            status: true,
            account: { select: { customer: { select: { isActive: true } } } },
          },
        },
      },
    });
    if (!assignment || !isUsable(assignment.user)) return false;
    return purpose === 'VIEW' || assignment.unit.isActive;
  }
}

/** An active user of an active account (its owner customer is active) */
function isUsable(user: {
  status: string;
  account: { customer: { isActive: boolean } };
}): boolean {
  return user.status === 'ACTIVE' && user.account.customer.isActive;
}

function toShopUser(user: ShopUserRecord): ShopUser {
  return {
    id: user.id,
    accountCustomerNumber: user.accountCustomerNumber,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
