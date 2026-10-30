import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { fromDbDate, toDbDate } from '../common/dates';
import { currencyPrecisionError, formatInCurrency } from '../common/money';
import { toPartnerSummary } from '../common/partner-summary';
import {
  conditionTypeViolations,
  scopeViolations,
  toConditionTypeSummary,
} from '../condition-types/condition-type-rules';
import { Prisma } from '../generated/prisma/client';
import { PriceConditionScope } from '../generated/prisma/enums';
import { EXCLUSION_VIOLATION, isPostgresError } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  findSalesArea,
  formatSalesArea,
  SalesAreaKey,
  salesAreaKeyOf,
  salesAreaViolations,
  SalesAreaWithCurrency,
  sameSalesArea,
  unitNotInSalesArea,
} from '../sales-areas/sales-area-key';
import { CreatePriceConditionDto } from './dto/create-price-condition.dto';
import { UpdatePriceConditionDto } from './dto/update-price-condition.dto';
import { PriceCondition } from './price-condition.interface';

const CONDITION_INCLUDE = {
  conditionType: true,
  material: true,
  soldTo: true,
  unit: { include: { soldTo: { include: { customer: true } } } },
  salesOrgCurrency: { include: { currency: true } },
} satisfies Prisma.PriceConditionInclude;

type ConditionRecord = Prisma.PriceConditionGetPayload<{
  include: typeof CONDITION_INCLUDE;
}>;

type Db = Prisma.TransactionClient;

/**
 * What a condition is for: the sales area, and in it a Sold-to, a B2B unit
 * or nothing more (list price of the sales area)
 */
type ConditionKey = SalesAreaKey & {
  scope: PriceConditionScope;
  soldToCustomerNumber: string | null;
  unitId: string | null;
};

/** Validity period as YYYY-MM-DD; validTo null means open-ended */
type Period = { validFrom: string; validTo: string | null };

// Condition IDs are PostgreSQL integers (SERIAL)
const MAX_CONDITION_ID = 2_147_483_647;

@Injectable()
export class PriceConditionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<PriceCondition[]> {
    const conditions = await this.prisma.priceCondition.findMany({
      include: CONDITION_INCLUDE,
      orderBy: [
        { salesOrganization: 'asc' },
        { distributionChannel: 'asc' },
        { division: 'asc' },
        { materialNumber: 'asc' },
        { scope: 'asc' },
        { soldToCustomerNumber: 'asc' },
        { unitId: 'asc' },
        { validFrom: 'asc' },
        { conditionId: 'asc' },
      ],
    });
    return conditions.map(toPriceCondition);
  }

  async findOne(conditionId: number): Promise<PriceCondition> {
    const condition = isConditionId(conditionId)
      ? await this.prisma.priceCondition.findUnique({
          where: { conditionId },
          include: CONDITION_INCLUDE,
        })
      : null;
    if (!condition) {
      throw notFound(conditionId);
    }
    return toPriceCondition(condition);
  }

  // As in the B2B units service, the transactions only check and write; the
  // result is loaded after the commit.

  async create(dto: CreatePriceConditionDto): Promise<PriceCondition> {
    let conditionId: number;
    try {
      conditionId = await this.prisma.$transaction(async (tx) => {
        const materialExists = await lockMaterial(tx, dto.materialNumber);

        const key: ConditionKey = {
          ...salesAreaKeyOf(dto),
          scope: dto.scope,
          soldToCustomerNumber: dto.soldToCustomerNumber ?? null,
          unitId: dto.unitId ?? null,
        };
        const period: Period = {
          validFrom: dto.validFrom,
          validTo: dto.validTo ?? null,
        };
        const isActive = dto.isActive ?? true;

        const salesArea = await findSalesArea(tx, key);
        const violations = salesAreaViolations(key, salesArea);
        violations.push(
          ...(await checkConditionType(tx, dto.conditionTypeCode, dto.scope)),
        );
        if (!materialExists) {
          violations.push(
            `materialNumber ${dto.materialNumber} does not exist`,
          );
        }
        // Market checks need a configured sales area
        if (salesArea) {
          violations.push(...checkCurrency(salesArea, dto.currency));
          violations.push(...checkAmount(salesArea, dto.amount));
          violations.push(...(await checkKey(tx, key)));
        }
        violations.push(...checkPeriod(period));
        if (!salesArea || violations.length > 0) {
          throw new UnprocessableEntityException(violations);
        }

        if (isActive) {
          await assertNoOverlap(tx, dto.materialNumber, key, period);
        }

        const created = await tx.priceCondition.create({
          data: {
            conditionTypeCode: dto.conditionTypeCode,
            materialNumber: dto.materialNumber,
            ...key,
            amount: dto.amount,
            // Always the currency of the sales area
            currency: salesArea.currency.code,
            validFrom: toDbDate(period.validFrom),
            validTo: period.validTo === null ? null : toDbDate(period.validTo),
            isActive,
          },
        });
        return created.conditionId;
      });
    } catch (error) {
      throw mapWriteError(error);
    }
    return this.findOne(conditionId);
  }

  /**
   * Changes amount, validity period and status. Condition type, sales area,
   * material, scope, key and currency cannot be changed; a different key
   * needs a new condition.
   */
  async update(
    conditionId: number,
    dto: UpdatePriceConditionDto,
  ): Promise<PriceCondition> {
    if (!isConditionId(conditionId)) {
      throw notFound(conditionId);
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        // The material never changes, so it can be read before the lock
        const before = await tx.priceCondition.findUnique({
          where: { conditionId },
          select: { materialNumber: true },
        });
        if (!before) {
          throw notFound(conditionId);
        }
        await lockMaterial(tx, before.materialNumber);

        // Read again after the lock, so a concurrent update of the same
        // condition has committed and its result is the starting point
        const current = await tx.priceCondition.findUniqueOrThrow({
          where: { conditionId },
        });
        const key: ConditionKey = {
          ...salesAreaKeyOf(current),
          scope: current.scope,
          soldToCustomerNumber: current.soldToCustomerNumber,
          unitId: current.unitId,
        };
        const period: Period = {
          validFrom: dto.validFrom ?? fromDbDate(current.validFrom),
          validTo:
            dto.validTo === undefined
              ? current.validTo && fromDbDate(current.validTo)
              : dto.validTo,
        };
        const isActive = dto.isActive ?? current.isActive;
        // The sales area of a stored condition always exists (foreign key)
        const salesArea = (await findSalesArea(tx, key))!;

        const violations = checkPeriod(period);
        if (dto.amount !== undefined) {
          violations.push(...checkAmount(salesArea, dto.amount));
        }
        // A reactivated condition must be valid like a new one. An active
        // condition stays valid when its Sold-to, unit, condition type or
        // sales area becomes inactive.
        if (isActive && !current.isActive) {
          violations.push(...salesAreaViolations(key, salesArea));
          violations.push(
            ...(await checkConditionType(
              tx,
              current.conditionTypeCode,
              current.scope,
            )),
          );
          violations.push(...(await checkKey(tx, key)));
        }
        if (violations.length > 0) {
          throw new UnprocessableEntityException(violations);
        }

        if (isActive) {
          await assertNoOverlap(
            tx,
            current.materialNumber,
            key,
            period,
            conditionId,
          );
        }

        await tx.priceCondition.update({
          where: { conditionId },
          data: {
            amount: dto.amount,
            validFrom:
              dto.validFrom === undefined ? undefined : toDbDate(dto.validFrom),
            validTo:
              dto.validTo === undefined || dto.validTo === null
                ? dto.validTo
                : toDbDate(dto.validTo),
            isActive: dto.isActive,
          },
        });
      });
    } catch (error) {
      throw mapWriteError(error);
    }
    return this.findOne(conditionId);
  }
}

/**
 * Locks the material row on the transaction's connection. All writes of
 * price conditions for one material wait for each other here, so the
 * overlap check always sees every committed condition. Returns false if
 * the material does not exist.
 */
async function lockMaterial(db: Db, materialNumber: string) {
  const rows = await db.$queryRaw<{ material_number: string }[]>`
    SELECT material_number FROM materials
    WHERE material_number = ${materialNumber} FOR UPDATE`;
  return rows.length > 0;
}

/**
 * The condition type must exist, be active, be supported for prices and be
 * configured for the scope (e.g. ZP01 only for SALES_AREA)
 */
async function checkConditionType(
  db: Db,
  code: string,
  scope: PriceConditionScope,
): Promise<string[]> {
  const type = await db.conditionType.findUnique({
    where: { code },
    include: { allowedScopes: true },
  });
  const violations = conditionTypeViolations(code, type);
  if (violations.length > 0 || !type) return violations;
  return scopeViolations(code, type, scope);
}

/** The currency comes from the sales area; a sent currency must match it */
function checkCurrency(
  salesArea: SalesAreaWithCurrency,
  currency: string | undefined,
): string[] {
  return currency === undefined || currency === salesArea.currency.code
    ? []
    : [
        `currency must be ${salesArea.currency.code}, the currency of sales area ${formatSalesArea(salesArea.key)}`,
      ];
}

/** The amount must fit the decimal places of the currency (JPY: none) */
function checkAmount(
  salesArea: SalesAreaWithCurrency,
  amount: string,
): string[] {
  const error = currencyPrecisionError(
    'amount',
    new Prisma.Decimal(amount),
    salesArea.currency,
  );
  return error ? [error] : [];
}

/**
 * The key must be usable in the sales area: a Sold-to must exist, be active
 * and be actively assigned to the sales area; a unit must exist, be active,
 * have an active Sold-to and belong to the sales area. The list price of a
 * sales area has no further key.
 */
async function checkKey(db: Db, key: ConditionKey): Promise<string[]> {
  const area = formatSalesArea(key);
  if (key.scope === PriceConditionScope.SALES_AREA) return [];

  if (key.scope === PriceConditionScope.SOLD_TO) {
    const number = key.soldToCustomerNumber!;
    const customer = await db.customer.findUnique({
      where: { customerNumber: number },
      include: { salesAreas: { where: salesAreaKeyOf(key) } },
    });
    if (!customer) return [`soldToCustomerNumber ${number} does not exist`];
    if (!customer.isActive)
      return [`soldToCustomerNumber ${number} is inactive`];
    const assignment = customer.salesAreas[0];
    if (!assignment) {
      return [
        `soldToCustomerNumber ${number} is not assigned to sales area ${area}`,
      ];
    }
    if (!assignment.isActive) {
      return [
        `soldToCustomerNumber ${number} is inactive in sales area ${area}`,
      ];
    }
    return [];
  }

  const unitId = key.unitId!;
  const unit = await db.b2bUnit.findUnique({
    where: { unitId },
    include: { soldTo: { include: { customer: true } } },
  });
  if (!unit) return [`unitId ${unitId} does not exist`];
  if (!sameSalesArea(unit, key)) {
    return [unitNotInSalesArea(unitId, unit, key)];
  }
  const violations: string[] = [];
  if (!unit.isActive) violations.push(`unitId ${unitId} is inactive`);
  if (!unit.soldTo.customer.isActive) {
    violations.push(
      `unitId ${unitId} has an inactive Sold-to ${unit.soldToCustomerNumber}`,
    );
  }
  return violations;
}

function checkPeriod(period: Period): string[] {
  // YYYY-MM-DD texts compare like dates
  return period.validTo !== null && period.validTo < period.validFrom
    ? ['validTo must not be before validFrom']
    : [];
}

/**
 * Active conditions with the same sales area, material and key must not
 * overlap. The exclusion constraints in the database enforce the same rule;
 * this check gives the client a clear message with the conflicting condition.
 */
async function assertNoOverlap(
  db: Db,
  materialNumber: string,
  key: ConditionKey,
  period: Period,
  exceptConditionId?: number,
) {
  const conflict = await db.priceCondition.findFirst({
    where: {
      materialNumber,
      ...key,
      isActive: true,
      conditionId:
        exceptConditionId === undefined
          ? undefined
          : { not: exceptConditionId },
      // Two periods overlap if each one starts before the other one ends
      validFrom:
        period.validTo === null ? undefined : { lte: toDbDate(period.validTo) },
      OR: [{ validTo: null }, { validTo: { gte: toDbDate(period.validFrom) } }],
    },
    orderBy: { validFrom: 'asc' },
  });
  if (conflict) {
    const until = conflict.validTo
      ? fromDbDate(conflict.validTo)
      : 'open-ended';
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: `The validity period overlaps with active price condition ${conflict.conditionId} (${fromDbDate(conflict.validFrom)} to ${until})`,
      conflictingConditionId: conflict.conditionId,
    });
  }
}

function mapWriteError(error: unknown) {
  // With the material lock, the exclusion constraint can only fail if a
  // condition was written without the lock (e.g. directly in SQL)
  if (isPostgresError(error, EXCLUSION_VIOLATION)) {
    return new ConflictException(
      'The validity period overlaps with another active price condition. Please reload and try again.',
    );
  }
  return error;
}

function isConditionId(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_CONDITION_ID;
}

function toPriceCondition(condition: ConditionRecord): PriceCondition {
  return {
    conditionId: condition.conditionId,
    conditionType: toConditionTypeSummary(condition.conditionType),
    salesArea: salesAreaKeyOf(condition),
    materialNumber: condition.materialNumber,
    materialDescription: condition.material.description,
    scope: condition.scope,
    soldTo: condition.soldTo && toPartnerSummary(condition.soldTo),
    unit: condition.unit && {
      unitId: condition.unit.unitId,
      name: condition.unit.name,
      isActive: condition.unit.isActive,
      soldTo: toPartnerSummary(condition.unit.soldTo.customer),
    },
    // With the decimal places of the currency, e.g. "4400.00" or "700000"
    amount: formatInCurrency(
      condition.amount,
      condition.salesOrgCurrency.currency,
    ),
    currency: condition.currency,
    validFrom: fromDbDate(condition.validFrom),
    validTo: condition.validTo && fromDbDate(condition.validTo),
    isActive: condition.isActive,
  };
}

function notFound(conditionId: number) {
  return new NotFoundException(`Price condition ${conditionId} not found`);
}
