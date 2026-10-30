import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { toPartnerSummary } from '../common/partner-summary';
import { lockAssignments } from '../customer-sales-areas/assignment-rules';
import { Prisma } from '../generated/prisma/client';
import {
  FOREIGN_KEY_FAILED,
  isPrismaError,
  RECORD_NOT_FOUND,
  UNIQUE_CONSTRAINT_FAILED,
} from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  checkSalesArea,
  formatSalesArea,
  SalesAreaKey,
  salesAreaKeyOf,
} from '../sales-areas/sales-area-key';
import { B2bUnit } from './b2b-unit.interface';
import { CreateB2bUnitDto } from './dto/create-b2b-unit.dto';
import { UpdateB2bUnitDto } from './dto/update-b2b-unit.dto';

const UNIT_INCLUDE = {
  soldTo: {
    include: { customer: true, owner: { include: { customer: true } } },
  },
  billTo: { include: { customer: true } },
  payer: { include: { customer: true } },
  shipTos: {
    include: { member: { include: { customer: true } } },
    orderBy: { customerNumber: 'asc' },
  },
} satisfies Prisma.B2bUnitInclude;

type UnitRecord = Prisma.B2bUnitGetPayload<{ include: typeof UNIT_INCLUDE }>;

type Db = Prisma.TransactionClient;

/** A partner that is checked before it is stored */
type PartnerCheck = {
  field: string;
  customerNumber: string;
  // Only new assignments must be active; existing ones may stay
  isNewAssignment: boolean;
  // The customer's assignment to the unit's sales area must be active: for
  // new assignments and for all partners when a unit is reactivated
  needsActiveSalesArea: boolean;
};

@Injectable()
export class B2bUnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<B2bUnit[]> {
    const units = await this.prisma.b2bUnit.findMany({
      include: UNIT_INCLUDE,
      orderBy: { unitId: 'asc' },
    });
    return units.map(toB2bUnit);
  }

  async findOne(unitId: string): Promise<B2bUnit> {
    const unit = await this.prisma.b2bUnit.findUnique({
      where: { unitId },
      include: UNIT_INCLUDE,
    });
    if (!unit) {
      throw notFound(unitId);
    }
    return toB2bUnit(unit);
  }

  // The transactions below only check and write. The result is loaded after
  // the commit: Prisma loads included relations in parallel, which a single
  // transaction connection would have to queue (deprecated in pg 9).

  /** Creates the unit and its ship-tos in one transaction */
  async create(dto: CreateB2bUnitDto): Promise<B2bUnit> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.b2bUnit.findUnique({
          where: { unitId: dto.unitId },
        });
        if (existing) {
          throw alreadyExists(dto.unitId);
        }

        const account = dto.accountCustomerNumber;
        const salesArea = salesAreaKeyOf(dto);
        const violations = [
          ...(await checkSalesArea(tx, salesArea)),
          ...(await checkAccount(tx, account)),
        ];
        // Partners can only be checked against a valid account and sales area
        if (violations.length === 0) {
          violations.push(
            ...(await checkPartners(tx, account, salesArea, [
              newPartner('soldToCustomerNumber', dto.soldToCustomerNumber),
              newPartner('billToCustomerNumber', dto.billToCustomerNumber),
              newPartner('payerCustomerNumber', dto.payerCustomerNumber),
              ...dto.shipToCustomerNumbers.map((number) =>
                newPartner('shipToCustomerNumbers', number),
              ),
            ])),
          );
        }
        if (
          !dto.shipToCustomerNumbers.includes(dto.defaultShipToCustomerNumber)
        ) {
          violations.push(DEFAULT_NOT_IN_LIST);
        }
        if (violations.length > 0) {
          throw new UnprocessableEntityException(violations);
        }

        await tx.b2bUnit.create({
          data: {
            unitId: dto.unitId,
            name: dto.name,
            accountCustomerNumber: account,
            soldToCustomerNumber: dto.soldToCustomerNumber,
            billToCustomerNumber: dto.billToCustomerNumber,
            payerCustomerNumber: dto.payerCustomerNumber,
            isActive: dto.isActive ?? true,
            ...salesArea,
          },
        });
        await tx.b2bUnitShipTo.createMany({
          data: dto.shipToCustomerNumbers.map((customerNumber) => ({
            unitId: dto.unitId,
            customerNumber,
            accountCustomerNumber: account,
            isDefault: customerNumber === dto.defaultShipToCustomerNumber,
            ...salesArea,
          })),
        });

        await assertExactlyOneDefault(tx, dto.unitId);
      });
    } catch (error) {
      // Another request created the same unit between our check and insert
      if (isPrismaError(error, UNIQUE_CONSTRAINT_FAILED)) {
        throw alreadyExists(dto.unitId);
      }
      // A partner was removed from the account after it was checked
      if (isPrismaError(error, FOREIGN_KEY_FAILED)) {
        throw changedConcurrently(
          `Customer account ${dto.accountCustomerNumber}`,
        );
      }
      throw error;
    }
    return this.findOne(dto.unitId);
  }

  /**
   * Updates name, Bill-to, Payer, ship-tos, default ship-to and status in
   * one transaction. Account, Sold-to and sales area cannot be changed.
   */
  async update(unitId: string, dto: UpdateB2bUnitDto): Promise<B2bUnit> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Lock the unit row first (on the transaction's connection). A second
        // update of the same unit waits here until this one has committed and
        // then reads the new state, so a complete ship-to list always replaces
        // the previous one instead of being merged with it.
        const locked = await tx.$queryRaw<{ unit_id: string }[]>`
          SELECT unit_id FROM b2b_units WHERE unit_id = ${unitId} FOR UPDATE`;
        if (locked.length === 0) {
          throw notFound(unitId);
        }

        const unit = await tx.b2bUnit.findUnique({
          where: { unitId },
          include: { shipTos: true },
        });
        if (!unit) {
          throw notFound(unitId);
        }

        const account = unit.accountCustomerNumber;
        const salesArea = salesAreaKeyOf(unit);
        const isReactivation = dto.isActive === true && !unit.isActive;
        const currentShipTos = unit.shipTos.map((s) => s.customerNumber);
        const currentDefault = unit.shipTos.find(
          (s) => s.isDefault,
        )?.customerNumber;

        const nextShipTos = dto.shipToCustomerNumbers ?? currentShipTos;
        const nextDefault = dto.defaultShipToCustomerNumber ?? currentDefault;
        const nextBillTo =
          dto.billToCustomerNumber ?? unit.billToCustomerNumber;
        const nextPayer = dto.payerCustomerNumber ?? unit.payerCustomerNumber;

        const added = nextShipTos.filter((n) => !currentShipTos.includes(n));
        const removed = currentShipTos.filter((n) => !nextShipTos.includes(n));

        // Unchanged partners are not checked again, so a partner that became
        // inactive after it was assigned may stay assigned
        const checks: PartnerCheck[] = added.map((n) =>
          newPartner('shipToCustomerNumbers', n),
        );
        if (nextBillTo !== unit.billToCustomerNumber) {
          checks.push(newPartner('billToCustomerNumber', nextBillTo));
        }
        if (nextPayer !== unit.payerCustomerNumber) {
          checks.push(newPartner('payerCustomerNumber', nextPayer));
        }
        if (
          nextDefault &&
          nextDefault !== currentDefault &&
          !added.includes(nextDefault)
        ) {
          checks.push(newPartner('defaultShipToCustomerNumber', nextDefault));
        }
        // A reactivated unit is offered for ordering again, so its sales area
        // and the assignments of all partners it keeps must be active again
        const violations: string[] = [];
        if (isReactivation) {
          violations.push(...(await checkSalesArea(tx, salesArea)));
          checks.push(
            keptPartner('soldToCustomerNumber', unit.soldToCustomerNumber),
          );
          if (nextBillTo === unit.billToCustomerNumber) {
            checks.push(keptPartner('billToCustomerNumber', nextBillTo));
          }
          if (nextPayer === unit.payerCustomerNumber) {
            checks.push(keptPartner('payerCustomerNumber', nextPayer));
          }
          for (const n of nextShipTos.filter((n) => !added.includes(n))) {
            checks.push(keptPartner('shipToCustomerNumbers', n));
          }
        }

        violations.push(
          ...(await checkPartners(tx, account, salesArea, checks)),
        );
        if (!nextDefault || !nextShipTos.includes(nextDefault)) {
          violations.push(DEFAULT_NOT_IN_LIST);
        }
        if (violations.length > 0) {
          throw new UnprocessableEntityException(violations);
        }

        await tx.b2bUnit.update({
          where: { unitId },
          data: {
            name: dto.name,
            billToCustomerNumber: dto.billToCustomerNumber,
            payerCustomerNumber: dto.payerCustomerNumber,
            isActive: dto.isActive,
          },
        });

        // The order keeps at most one default at every step, as required
        // by the partial unique index: remove, unset old, add, set new
        if (removed.length > 0) {
          await tx.b2bUnitShipTo.deleteMany({
            where: { unitId, customerNumber: { in: removed } },
          });
        }
        if (
          currentDefault &&
          currentDefault !== nextDefault &&
          !removed.includes(currentDefault)
        ) {
          await tx.b2bUnitShipTo.update({
            where: {
              unitId_customerNumber: { unitId, customerNumber: currentDefault },
            },
            data: { isDefault: false },
          });
        }
        if (added.length > 0) {
          await tx.b2bUnitShipTo.createMany({
            data: added.map((customerNumber) => ({
              unitId,
              customerNumber,
              accountCustomerNumber: account,
              isDefault: false,
              ...salesArea,
            })),
          });
        }
        if (nextDefault !== currentDefault) {
          await tx.b2bUnitShipTo.update({
            where: {
              unitId_customerNumber: { unitId, customerNumber: nextDefault! },
            },
            data: { isDefault: true },
          });
        }

        await assertExactlyOneDefault(tx, unitId);
      });
    } catch (error) {
      // A missing unit was already reported as 404 above. With the row lock,
      // the database can only reject a checked change if data used by the
      // check changed at the same time: the default index (P2002), a row that
      // disappeared (P2025) or a membership removed from the account (P2003).
      if (
        isPrismaError(error, UNIQUE_CONSTRAINT_FAILED) ||
        isPrismaError(error, RECORD_NOT_FOUND) ||
        isPrismaError(error, FOREIGN_KEY_FAILED)
      ) {
        throw changedConcurrently(`B2B unit ${unitId}`);
      }
      throw error;
    }
    return this.findOne(unitId);
  }
}

function changedConcurrently(subject: string) {
  return new ConflictException(
    `${subject} was changed at the same time. Please reload and try again.`,
  );
}

const DEFAULT_NOT_IN_LIST =
  'defaultShipToCustomerNumber must be one of shipToCustomerNumbers';

function newPartner(field: string, customerNumber: string): PartnerCheck {
  return {
    field,
    customerNumber,
    isNewAssignment: true,
    needsActiveSalesArea: true,
  };
}

/** A partner that stays assigned while the unit is reactivated */
function keptPartner(field: string, customerNumber: string): PartnerCheck {
  return {
    field,
    customerNumber,
    isNewAssignment: false,
    needsActiveSalesArea: true,
  };
}

/** The account must be an active customer account (an owner row) */
async function checkAccount(db: Db, account: string): Promise<string[]> {
  const customer = await db.customer.findUnique({
    where: { customerNumber: account },
    include: { accountMembership: true },
  });
  const membership = customer?.accountMembership;
  if (!customer) {
    return [`accountCustomerNumber ${account} does not exist`];
  }
  if (!membership || membership.accountCustomerNumber !== account) {
    return [`accountCustomerNumber ${account} is not a customer account`];
  }
  if (!customer.isActive) {
    return [`accountCustomerNumber ${account} is inactive`];
  }
  return [];
}

/**
 * Every partner must exist and belong to the account (the owner itself or a
 * member). New assignments must also be active. Partners that need an
 * active sales area (see PartnerCheck) must have an active assignment to the
 * unit's sales area; those assignments stay locked until the transaction
 * ends, so they cannot be deactivated at the same time.
 */
async function checkPartners(
  db: Db,
  account: string,
  salesArea: SalesAreaKey,
  checks: PartnerCheck[],
): Promise<string[]> {
  if (checks.length === 0) return [];

  const numbers = [...new Set(checks.map((c) => c.customerNumber))];
  const customers = await db.customer.findMany({
    where: { customerNumber: { in: numbers } },
    include: { accountMembership: true },
  });
  const assignments = await lockAssignments(
    db,
    salesArea,
    checks.filter((c) => c.needsActiveSalesArea).map((c) => c.customerNumber),
  );
  const area = formatSalesArea(salesArea);

  const violations: string[] = [];
  for (const check of checks) {
    const { field, customerNumber, isNewAssignment } = check;
    const customer = customers.find((c) => c.customerNumber === customerNumber);
    const assignment = assignments.get(customerNumber);
    if (!customer) {
      violations.push(`${field} ${customerNumber} does not exist`);
    } else if (customer.accountMembership?.accountCustomerNumber !== account) {
      violations.push(
        `${field} ${customerNumber} does not belong to account ${account}`,
      );
    } else if (isNewAssignment && !customer.isActive) {
      violations.push(`${field} ${customerNumber} is inactive`);
    } else if (!check.needsActiveSalesArea) {
      continue;
    } else if (assignment === undefined) {
      violations.push(
        `${field} ${customerNumber} is not assigned to sales area ${area}`,
      );
    } else if (!assignment) {
      violations.push(
        `${field} ${customerNumber} is inactive in sales area ${area}`,
      );
    }
  }
  return violations;
}

/**
 * The partial unique index guarantees at most one default ship-to.
 * This check completes the rule "exactly one" before the transaction ends;
 * if it fails, the whole transaction is rolled back.
 */
async function assertExactlyOneDefault(db: Db, unitId: string) {
  const defaults = await db.b2bUnitShipTo.count({
    where: { unitId, isDefault: true },
  });
  if (defaults !== 1) {
    throw new Error(
      `B2B unit ${unitId} would have ${defaults} default ship-tos instead of 1`,
    );
  }
}

function toB2bUnit(unit: UnitRecord): B2bUnit {
  const defaultShipTo = unit.shipTos.find((shipTo) => shipTo.isDefault);
  return {
    unitId: unit.unitId,
    name: unit.name,
    isActive: unit.isActive,
    salesArea: salesAreaKeyOf(unit),
    account: toPartnerSummary(unit.soldTo.owner.customer),
    soldTo: toPartnerSummary(unit.soldTo.customer),
    billTo: toPartnerSummary(unit.billTo.customer),
    payer: toPartnerSummary(unit.payer.customer),
    shipTos: unit.shipTos.map((shipTo) => ({
      ...toPartnerSummary(shipTo.member.customer),
      isDefault: shipTo.isDefault,
    })),
    defaultShipToCustomerNumber: defaultShipTo?.customerNumber ?? '',
  };
}

function notFound(unitId: string) {
  return new NotFoundException(`B2B unit ${unitId} not found`);
}

function alreadyExists(unitId: string) {
  return new ConflictException(`B2B unit ${unitId} already exists`);
}
