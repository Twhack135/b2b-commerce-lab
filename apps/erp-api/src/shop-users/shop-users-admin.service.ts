import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Clock } from '../common/clock';
import {
  FOREIGN_KEY_FAILED,
  isPrismaError,
  UNIQUE_CONSTRAINT_FAILED,
} from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  activationLink,
  passwordResetLink,
  SHOP_PUBLIC_URL_ENV,
  shopOrigin,
} from '../shop/auth/activation-link';
import {
  isSessionOpen,
  SESSION_IDLE_MS,
  sessionEndsAt,
} from '../shop/auth/session-rules';
import {
  ActivationNotPossibleError,
  PasswordResetNotPossibleError,
} from '../shop/auth/shop-auth.errors';
import { ShopAuthService } from '../shop/auth/shop-auth.service';
import {
  isUuid,
  normalizeDisplayName,
  normalizeEmail,
  ShopUserRuleError,
} from '../shop/users/shop-user-rules';
import { ShopUsersService } from '../shop/users/shop-users.service';
import { CreateShopUserDto } from './dto/create-shop-user.dto';
import { UpdateShopUserDto } from './dto/update-shop-user.dto';
import {
  activationState,
  shopAccess,
  unitAccess,
} from './shop-user-admin-rules';
import {
  IssuedActivationLink,
  IssuedPasswordResetLink,
  ShopUserDetail,
  ShopUserSummary,
} from './shop-user-admin.interface';

const userNotFound = () => new NotFoundException('Shop user not found.');

/** A business rule violation as the Backoffice shows it */
function ruleException(error: ShopUserRuleError, unitId?: string) {
  switch (error.code) {
    case 'USER_NOT_FOUND':
      return userNotFound();
    case 'EMAIL_TAKEN':
      return new ConflictException(error.message);
    default:
      return new UnprocessableEntityException(
        unitId ? `${unitId}: ${error.message}` : error.message,
      );
  }
}

/** Raised inside the creation transaction, answered after its rollback */
class UnitRuleError extends Error {
  constructor(
    readonly rule: ShopUserRuleError,
    readonly unitId: string,
  ) {
    super(rule.message);
  }
}

const ACTIVATION_REFUSALS = {
  USER_DISABLED: 'The shop user is disabled. Enable the user first.',
  ACCOUNT_INACTIVE: 'The customer account of the shop user is inactive.',
  ALREADY_ACTIVATED:
    'The shop user has already set a password. Activation links are only for the first password.',
} as const;

const RESET_REFUSALS = {
  USER_DISABLED: 'The shop user is disabled. Enable the user first.',
  ACCOUNT_INACTIVE: 'The customer account of the shop user is inactive.',
  NOT_ACTIVATED:
    'The shop user has not set a password yet. Create an activation link instead.',
} as const;

/**
 * Local administration of shop users for the Backoffice (Sprint 12C,
 * docs/adr/0007): part of the admin API, which has no administrator
 * authentication yet and therefore only runs on this computer (ADR 0006).
 * The authorization rules themselves stay in ShopUsersService and the
 * database; this service reads and changes the records.
 */
@Injectable()
export class ShopUsersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: ShopUsersService,
    private readonly auth: ShopAuthService,
    private readonly clock: Clock,
  ) {}

  async findAll(): Promise<ShopUserSummary[]> {
    const now = this.clock.now();
    const records = await this.prisma.shopUser.findMany({
      orderBy: [{ accountCustomerNumber: 'asc' }, { email: 'asc' }],
      select: userSelect(now),
    });
    return records.map((record) => toSummary(toDetail(record, now)));
  }

  async findOne(userId: string): Promise<ShopUserDetail> {
    if (!isUuid(userId)) throw userNotFound();
    const now = this.clock.now();
    const record = await this.prisma.shopUser.findUnique({
      where: { id: userId },
      select: userSelect(now),
    });
    if (!record) throw userNotFound();
    return toDetail(record, now);
  }

  /**
   * A new, active buyer of an active customer account, optionally with
   * active units of that account, in one transaction: either the user and
   * all assignments are stored, or nothing.
   */
  async create(dto: CreateShopUserDto): Promise<ShopUserDetail> {
    const email = normalizeEmail(dto.email);
    if (!email) throw ruleException(new ShopUserRuleError('EMAIL_INVALID'));
    const displayName = normalizeDisplayName(dto.displayName);
    if (!displayName) {
      throw ruleException(new ShopUserRuleError('DISPLAY_NAME_INVALID'));
    }
    const unitIds = dto.unitIds ?? [];

    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const account = await tx.customerAccountMember.findUnique({
          where: { customerNumber: dto.accountCustomerNumber },
          include: { customer: { select: { isActive: true } } },
        });
        // An account is the owner row; a member customer is no account
        if (
          !account ||
          account.accountCustomerNumber !== account.customerNumber
        ) {
          throw new ShopUserRuleError('ACCOUNT_NOT_FOUND');
        }
        if (!account.customer.isActive) {
          throw new ShopUserRuleError('ACCOUNT_INACTIVE');
        }
        const units = await tx.b2bUnit.findMany({
          where: { unitId: { in: unitIds } },
          select: { unitId: true, accountCustomerNumber: true, isActive: true },
        });
        for (const unitId of unitIds) {
          const unit = units.find((u) => u.unitId === unitId);
          const code = !unit
            ? 'UNIT_NOT_FOUND'
            : unit.accountCustomerNumber !== account.accountCustomerNumber
              ? 'UNIT_OF_OTHER_ACCOUNT'
              : !unit.isActive
                ? 'UNIT_INACTIVE'
                : null;
          if (code) {
            throw new UnitRuleError(new ShopUserRuleError(code), unitId);
          }
        }
        const user = await tx.shopUser.create({
          data: {
            accountCustomerNumber: account.accountCustomerNumber,
            accountOwnerRef: account.accountCustomerNumber,
            email,
            displayName,
          },
          select: { id: true },
        });
        if (unitIds.length > 0) {
          await tx.shopUserUnit.createMany({
            data: unitIds.map((unitId) => ({
              userId: user.id,
              unitId,
              accountCustomerNumber: account.accountCustomerNumber,
            })),
          });
        }
        return user.id;
      });
    } catch (error) {
      if (error instanceof UnitRuleError) {
        throw ruleException(error.rule, error.unitId);
      }
      if (error instanceof ShopUserRuleError) throw ruleException(error);
      if (isPrismaError(error, UNIQUE_CONSTRAINT_FAILED)) {
        throw ruleException(new ShopUserRuleError('EMAIL_TAKEN'));
      }
      // The database refuses units outside the account in any case
      if (isPrismaError(error, FOREIGN_KEY_FAILED)) {
        throw ruleException(new ShopUserRuleError('UNIT_OF_OTHER_ACCOUNT'));
      }
      throw error;
    }
    return this.findOne(userId);
  }

  /**
   * Changes the display name and/or the status. Disabling ends every
   * session of the user at once (database trigger); enabling again
   * restores none of them, the user signs in anew.
   */
  async update(
    userId: string,
    dto: UpdateShopUserDto,
  ): Promise<ShopUserDetail> {
    if (!isUuid(userId)) throw userNotFound();
    const data: { displayName?: string; status?: 'ACTIVE' | 'DISABLED' } = {};
    if (dto.displayName !== undefined) {
      const displayName = normalizeDisplayName(dto.displayName);
      if (!displayName) {
        throw ruleException(new ShopUserRuleError('DISPLAY_NAME_INVALID'));
      }
      data.displayName = displayName;
    }
    if (dto.status !== undefined) data.status = dto.status;
    const { count } = await this.prisma.shopUser.updateMany({
      where: { id: userId },
      data,
    });
    if (count === 0) throw userNotFound();
    return this.findOne(userId);
  }

  /** Assigns an active unit of the user's own account; again is no error */
  async assignUnit(userId: string, unitId: string): Promise<ShopUserDetail> {
    try {
      await this.users.assignUnit(userId, unitId);
    } catch (error) {
      if (error instanceof ShopUserRuleError) {
        if (error.code === 'UNIT_NOT_FOUND') {
          throw new NotFoundException(`B2B unit ${unitId} not found.`);
        }
        throw ruleException(error, unitId);
      }
      throw error;
    }
    return this.findOne(userId);
  }

  /**
   * Withdraws the unit; it takes effect with the user's next request.
   * The unit, its partners and all orders stay as they are.
   */
  async unassignUnit(userId: string, unitId: string): Promise<ShopUserDetail> {
    await this.findOne(userId);
    await this.users.unassignUnit(userId, unitId);
    return this.findOne(userId);
  }

  /**
   * A new one-time activation link (valid 24 hours), replacing an unused
   * one. Returned exactly once; the ERP keeps only the hash of its token.
   */
  async issueActivationLink(userId: string): Promise<IssuedActivationLink> {
    const origin = shopOrigin(process.env[SHOP_PUBLIC_URL_ENV]);
    if (!origin) {
      throw new ServiceUnavailableException(
        `${SHOP_PUBLIC_URL_ENV} is not a valid shop address (https, or http on this computer).`,
      );
    }
    try {
      const { token, expiresAt } = await this.auth.issueActivation(userId);
      return {
        activationLink: activationLink(origin, token),
        expiresAt: expiresAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof ActivationNotPossibleError) {
        if (error.reason === 'USER_NOT_FOUND') throw userNotFound();
        throw new ConflictException(ACTIVATION_REFUSALS[error.reason]);
      }
      throw error;
    }
  }

  /**
   * A new one-time password reset link (valid 4 hours) for an activated
   * user, replacing an unused one. Returned exactly once; the ERP keeps
   * only the hash of its token. The current password stays valid until the
   * link is used; using it ends every session of the user.
   */
  async issuePasswordResetLink(
    userId: string,
  ): Promise<IssuedPasswordResetLink> {
    const origin = shopOrigin(process.env[SHOP_PUBLIC_URL_ENV]);
    if (!origin) {
      throw new ServiceUnavailableException(
        `${SHOP_PUBLIC_URL_ENV} is not a valid shop address (https, or http on this computer).`,
      );
    }
    try {
      const { token, expiresAt } = await this.auth.issuePasswordReset(userId);
      return {
        resetLink: passwordResetLink(origin, token),
        expiresAt: expiresAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof PasswordResetNotPossibleError) {
        if (error.reason === 'USER_NOT_FOUND') throw userNotFound();
        throw new ConflictException(RESET_REFUSALS[error.reason]);
      }
      throw error;
    }
  }

  /** Ends one session of the user (it cannot be used again) */
  async revokeSession(
    userId: string,
    sessionId: string,
  ): Promise<ShopUserDetail> {
    await this.findOne(userId);
    const session = isUuid(sessionId)
      ? await this.prisma.shopSession.findFirst({
          where: { id: sessionId, userId },
          select: { id: true },
        })
      : null;
    if (!session) throw new NotFoundException('Session not found.');
    await this.revoke(userId, sessionId);
    return this.findOne(userId);
  }

  /**
   * Ends every session of the user. Signing in again stays possible; to
   * withdraw access, disable the user.
   */
  async revokeAllSessions(userId: string): Promise<ShopUserDetail> {
    await this.findOne(userId);
    await this.revoke(userId);
    return this.findOne(userId);
  }

  private async revoke(userId: string, sessionId?: string): Promise<void> {
    // Never before the session began (CHECK constraint), as in the triggers
    const now = this.clock.now();
    if (sessionId) {
      await this.prisma.$executeRaw`
        UPDATE shop_sessions SET revoked_at = GREATEST(${now}, created_at)
         WHERE user_id = ${userId}::uuid AND id = ${sessionId}::uuid
           AND revoked_at IS NULL`;
    } else {
      await this.prisma.$executeRaw`
        UPDATE shop_sessions SET revoked_at = GREATEST(${now}, created_at)
         WHERE user_id = ${userId}::uuid AND revoked_at IS NULL`;
    }
  }
}

/** Everything the administration shows; no hash is ever selected */
function userSelect(now: Date) {
  return {
    id: true,
    email: true,
    displayName: true,
    status: true,
    role: true,
    accountCustomerNumber: true,
    createdAt: true,
    updatedAt: true,
    account: {
      select: { customer: { select: { name: true, isActive: true } } },
    },
    credential: { select: { createdAt: true, updatedAt: true } },
    // At most one unused link exists (partial unique index)
    activationTokens: {
      where: { usedAt: null },
      select: { createdAt: true, expiresAt: true },
    },
    // At most one unused reset link exists (partial unique index)
    passwordResets: {
      where: { usedAt: null },
      select: { createdAt: true, expiresAt: true },
    },
    units: {
      orderBy: { unitId: 'asc' as const },
      select: {
        assignedAt: true,
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
    // Candidates; isSessionOpen decides with the rule of the sign-in
    sessions: {
      where: {
        revokedAt: null,
        expiresAt: { gt: now },
        lastSeenAt: { gt: new Date(now.getTime() - SESSION_IDLE_MS) },
      },
      orderBy: { createdAt: 'desc' as const },
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    },
  };
}

type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  role: 'BUYER';
  accountCustomerNumber: string;
  createdAt: Date;
  updatedAt: Date;
  account: { customer: { name: string; isActive: boolean } };
  credential: { createdAt: Date; updatedAt: Date } | null;
  activationTokens: { createdAt: Date; expiresAt: Date }[];
  passwordResets: { createdAt: Date; expiresAt: Date }[];
  units: {
    assignedAt: Date;
    unit: {
      unitId: string;
      name: string;
      isActive: boolean;
      salesOrganization: string;
      distributionChannel: string;
      division: string;
    };
  }[];
  sessions: {
    id: string;
    createdAt: Date;
    lastSeenAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
  }[];
};

function toDetail(record: UserRecord, now: Date): ShopUserDetail {
  const access = shopAccess(record.status, record.account.customer.isActive);
  const [openLink] = record.activationTokens;
  const [openReset] = record.passwordResets;
  const sessions = record.sessions.filter((s) => isSessionOpen(s, now));
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    status: record.status,
    role: record.role,
    account: {
      customerNumber: record.accountCustomerNumber,
      name: record.account.customer.name,
      isActive: record.account.customer.isActive,
    },
    access,
    activation: activationState(record.credential, openLink, now),
    unitCount: record.units.length,
    activeSessionCount: sessions.length,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    units: record.units.map(({ assignedAt, unit }) => ({
      unitId: unit.unitId,
      name: unit.name,
      isActive: unit.isActive,
      salesArea: {
        salesOrganization: unit.salesOrganization,
        distributionChannel: unit.distributionChannel,
        division: unit.division,
      },
      access: unitAccess(access, unit.isActive),
      assignedAt: assignedAt.toISOString(),
    })),
    sessions: sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      endsAt: sessionEndsAt(session).toISOString(),
    })),
    activationDetails: {
      activatedAt: record.credential?.createdAt.toISOString() ?? null,
      openLink:
        openLink && !record.credential
          ? {
              createdAt: openLink.createdAt.toISOString(),
              expiresAt: openLink.expiresAt.toISOString(),
            }
          : null,
    },
    passwordReset: {
      passwordChangedAt: record.credential?.updatedAt.toISOString() ?? null,
      // An expired link is no longer shown: a new one can be issued at once
      openLink:
        openReset && openReset.expiresAt > now
          ? {
              createdAt: openReset.createdAt.toISOString(),
              expiresAt: openReset.expiresAt.toISOString(),
            }
          : null,
    },
  };
}

/** The list fields only (allow list) */
function toSummary(detail: ShopUserDetail): ShopUserSummary {
  return {
    id: detail.id,
    email: detail.email,
    displayName: detail.displayName,
    status: detail.status,
    role: detail.role,
    account: detail.account,
    access: detail.access,
    activation: detail.activation,
    unitCount: detail.unitCount,
    activeSessionCount: detail.activeSessionCount,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}
