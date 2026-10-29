import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { fromDbDate } from '../common/dates';
import { formatAmount } from '../common/money';
import {
  LIST_PRICE_CONDITION_TYPE,
  toConditionTypeSummary,
} from '../condition-types/condition-type-rules';
import { ConditionTypeSummary } from '../condition-types/condition-type.interface';
import {
  ConditionType,
  Material,
  PriceCondition,
  Prisma,
} from '../generated/prisma/client';
import { PriceConditionScope } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import {
  ConditionCandidate,
  Determination,
  determinePrice,
  PricingStep,
} from './price-determination';
import { PriceResult, PriceResultStep } from './price-result.interface';

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Determines the price of a material for a B2B unit on a given date */
  async calculate(dto: CalculatePriceDto): Promise<PriceResult> {
    const [material, unit] = await Promise.all([
      this.prisma.material.findUnique({
        where: { materialNumber: dto.materialNumber },
      }),
      this.prisma.b2bUnit.findUnique({
        where: { unitId: dto.unitId },
        include: { soldTo: { include: { customer: true } } },
      }),
    ]);

    const violations: string[] = [];
    if (!material) {
      violations.push(`materialNumber ${dto.materialNumber} does not exist`);
    }
    if (!unit) {
      violations.push(`unitId ${dto.unitId} does not exist`);
    } else {
      if (!unit.isActive) violations.push(`unitId ${dto.unitId} is inactive`);
      if (!unit.soldTo.customer.isActive) {
        violations.push(
          `unitId ${dto.unitId} has an inactive Sold-to ${unit.soldToCustomerNumber}`,
        );
      }
    }
    if (!material || !unit || violations.length > 0) {
      throw new UnprocessableEntityException(violations);
    }

    // All active conditions of the material for this unit or its Sold-to;
    // the validity on the pricing date is checked by determinePrice
    const conditions = await this.prisma.priceCondition.findMany({
      where: {
        materialNumber: material.materialNumber,
        isActive: true,
        OR: [
          { scope: PriceConditionScope.B2B_UNIT, unitId: unit.unitId },
          {
            scope: PriceConditionScope.SOLD_TO,
            soldToCustomerNumber: unit.soldToCustomerNumber,
          },
        ],
      },
      include: { conditionType: true },
    });
    const listPriceType = await loadListPriceType(this.prisma);

    const quantity = dto.quantity ?? 1;
    const result = determinePrice({
      pricingDate: dto.pricingDate,
      quantity,
      basePrice: material.price,
      currency: material.currency,
      candidates: conditions.map(toCandidate),
      baseConditionType: listPriceType,
    });

    return {
      materialNumber: material.materialNumber,
      materialDescription: material.description,
      unitId: unit.unitId,
      soldToCustomerNumber: unit.soldToCustomerNumber,
      pricingDate: dto.pricingDate,
      quantity,
      unitPrice: formatAmount(result.unitPrice),
      netValue: formatAmount(result.netValue),
      currency: result.currency,
      source: result.source,
      conditionType: result.conditionType,
      conditionId: result.condition?.conditionId ?? null,
      validFrom: result.condition?.validFrom ?? null,
      validTo: result.condition?.validTo ?? null,
      steps: toResultSteps(result.steps),
    };
  }

  /**
   * Prices several positions with four queries in total, however many
   * positions there are: the materials, the active conditions of these
   * materials for the unit and its Sold-to (with their condition types) and
   * the list price condition type. Every position is then priced on
   * its own by determinePrice, also if a material occurs more than once.
   *
   * Unlike calculate(), this does not check whether the unit or its
   * partners are active; the caller (e.g. the order simulation) decides
   * what to report. Pass a transaction client to read inside a transaction.
   * Without a unit (null), only the materials are looked up.
   */
  async priceItems(
    request: {
      unit: { unitId: string; soldToCustomerNumber: string } | null;
      pricingDate: string;
      items: { materialNumber: string; quantity: number }[];
    },
    db: Db = this.prisma,
  ): Promise<ItemPricing[]> {
    const materialNumbers = [
      ...new Set(request.items.map((item) => item.materialNumber)),
    ];
    // One after the other: a transaction client has a single connection
    const materials = await db.material.findMany({
      where: { materialNumber: { in: materialNumbers } },
    });
    const { unit } = request;
    const conditions = unit
      ? await db.priceCondition.findMany({
          where: {
            materialNumber: { in: materials.map((m) => m.materialNumber) },
            isActive: true,
            OR: [
              { scope: PriceConditionScope.B2B_UNIT, unitId: unit.unitId },
              {
                scope: PriceConditionScope.SOLD_TO,
                soldToCustomerNumber: unit.soldToCustomerNumber,
              },
            ],
          },
          include: { conditionType: true },
        })
      : [];
    const listPriceType = unit ? await loadListPriceType(db) : null;

    return request.items.map((item) => {
      const material =
        materials.find((m) => m.materialNumber === item.materialNumber) ?? null;
      if (!material || !unit) return { material, determination: null };
      return {
        material,
        determination: determinePrice({
          pricingDate: request.pricingDate,
          quantity: item.quantity,
          basePrice: material.price,
          currency: material.currency,
          candidates: conditions
            .filter((c) => c.materialNumber === material.materialNumber)
            .map(toCandidate),
          baseConditionType: listPriceType,
        }),
      };
    });
  }
}

type Db = Prisma.TransactionClient | PrismaService;

/** Result of priceItems for one position, in request order */
export interface ItemPricing {
  /** null if the material does not exist */
  material: Material | null;
  /** null without material or unit */
  determination: Determination | null;
}

/**
 * The condition type shown for the material base price (ZP01, transitional).
 * The price itself never depends on it: without the type, the base price
 * is still used, only without condition type metadata.
 */
async function loadListPriceType(db: Db): Promise<ConditionTypeSummary | null> {
  const type = await db.conditionType.findUnique({
    where: { code: LIST_PRICE_CONDITION_TYPE },
  });
  return type && toConditionTypeSummary(type);
}

function toCandidate(
  condition: PriceCondition & { conditionType: ConditionType },
): ConditionCandidate {
  return {
    conditionId: condition.conditionId,
    scope: condition.scope,
    amount: condition.amount,
    currency: condition.currency,
    validFrom: fromDbDate(condition.validFrom),
    validTo: condition.validTo && fromDbDate(condition.validTo),
    isActive: condition.isActive,
    conditionType: toConditionTypeSummary(condition.conditionType),
  };
}

/** Steps with amounts as decimal strings, as in the pricing API */
export function toResultSteps(steps: PricingStep[]): PriceResultStep[] {
  return steps.map((step) => ({
    source: step.source,
    conditionId: step.conditionId,
    amount: step.amount && formatAmount(step.amount),
    applied: step.applied,
    conditionType: step.conditionType,
  }));
}
