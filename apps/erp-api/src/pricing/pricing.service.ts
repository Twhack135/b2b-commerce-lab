import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { fromDbDate } from '../common/dates';
import { CurrencyPrecision, formatInCurrency } from '../common/money';
import { toConditionTypeSummary } from '../condition-types/condition-type-rules';
import {
  ConditionType,
  Material,
  PriceCondition,
  Prisma,
} from '../generated/prisma/client';
import { PriceConditionScope } from '../generated/prisma/enums';
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
import { CalculatePriceDto } from './dto/calculate-price.dto';
import {
  ConditionCandidate,
  Determination,
  determinePrice,
  PricingStep,
} from './price-determination';
import { PriceResult, PriceResultStep } from './price-result.interface';

/** Error code of the pricing API when no price exists */
export const NO_PRICE_FOUND = 'NO_PRICE_FOUND';

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Determines the price of a material for a B2B unit in a sales area on a
   * given date. The unit must belong to the sales area; the currency comes
   * from the sales area.
   */
  async calculate(dto: CalculatePriceDto): Promise<PriceResult> {
    const key = salesAreaKeyOf(dto);
    const [material, unit, salesArea] = await Promise.all([
      this.prisma.material.findUnique({
        where: { materialNumber: dto.materialNumber },
      }),
      this.prisma.b2bUnit.findUnique({
        where: { unitId: dto.unitId },
        include: { soldTo: { include: { customer: true } } },
      }),
      findSalesArea(this.prisma, key),
    ]);

    const violations: string[] = [];
    if (!material) {
      violations.push(`materialNumber ${dto.materialNumber} does not exist`);
    }
    violations.push(...salesAreaViolations(key, salesArea));
    if (!unit) {
      violations.push(`unitId ${dto.unitId} does not exist`);
    } else {
      if (!unit.isActive) violations.push(`unitId ${dto.unitId} is inactive`);
      if (!unit.soldTo.customer.isActive) {
        violations.push(
          `unitId ${dto.unitId} has an inactive Sold-to ${unit.soldToCustomerNumber}`,
        );
      }
      // Never price a unit with the conditions of another market
      if (salesArea && !sameSalesArea(unit, key)) {
        violations.push(unitNotInSalesArea(dto.unitId, unit, key));
      }
    }
    if (!material || !unit || !salesArea || violations.length > 0) {
      throw new UnprocessableEntityException(violations);
    }

    const conditions = await this.prisma.priceCondition.findMany({
      where: conditionFilter(key, [material.materialNumber], unit),
      include: { conditionType: true },
    });

    const quantity = dto.quantity ?? 1;
    const result = determinePrice({
      pricingDate: dto.pricingDate,
      quantity,
      salesArea: key,
      currency: salesArea.currency,
      candidates: conditions.map(toCandidate),
    });

    if (result.status === 'NO_PRICE_FOUND') {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: NO_PRICE_FOUND,
        message: [noPriceText(material.materialNumber, key, dto.pricingDate)],
        // The analysis shows that every level was checked
        steps: toResultSteps(result.steps, salesArea.currency),
      });
    }

    return {
      materialNumber: material.materialNumber,
      materialDescription: material.description,
      salesArea: key,
      unitId: unit.unitId,
      soldToCustomerNumber: unit.soldToCustomerNumber,
      pricingDate: dto.pricingDate,
      quantity,
      unitPrice: formatInCurrency(result.unitPrice, salesArea.currency),
      netValue: formatInCurrency(result.netValue, salesArea.currency),
      currency: result.currency,
      source: result.source,
      conditionType: result.conditionType,
      conditionId: result.condition.conditionId,
      validFrom: result.condition.validFrom,
      validTo: result.condition.validTo,
      steps: toResultSteps(result.steps, salesArea.currency),
    };
  }

  /**
   * Prices several positions with two queries in total, however many
   * positions there are: the materials, and the active conditions of these
   * materials in the sales area for the unit, its Sold-to and the list
   * price (with their condition types). Every position is then priced on
   * its own by determinePrice, also if a material occurs more than once.
   *
   * Unlike calculate(), this does not check whether the unit, its partners
   * or the sales area are usable; the caller (e.g. the order simulation)
   * decides what to report and passes null for unit or sales area to
   * suppress pricing. Pass a transaction client to read inside a transaction.
   */
  async priceItems(
    request: {
      unit: { unitId: string; soldToCustomerNumber: string } | null;
      salesArea: SalesAreaWithCurrency | null;
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
    const { unit, salesArea } = request;
    const conditions =
      unit && salesArea
        ? await db.priceCondition.findMany({
            where: conditionFilter(
              salesArea.key,
              materials.map((m) => m.materialNumber),
              unit,
            ),
            include: { conditionType: true },
          })
        : [];

    return request.items.map((item) => {
      const material =
        materials.find((m) => m.materialNumber === item.materialNumber) ?? null;
      if (!material || !unit || !salesArea) {
        return { material, determination: null };
      }
      return {
        material,
        determination: determinePrice({
          pricingDate: request.pricingDate,
          quantity: item.quantity,
          salesArea: salesArea.key,
          currency: salesArea.currency,
          candidates: conditions
            .filter((c) => c.materialNumber === material.materialNumber)
            .map(toCandidate),
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
  /** null without material, unit or sales area */
  determination: Determination | null;
}

/**
 * Active conditions of the materials in exactly this sales area: for the
 * unit, for its Sold-to, and the list price of the sales area. The validity
 * on the pricing date is checked by determinePrice.
 */
function conditionFilter(
  key: SalesAreaKey,
  materialNumbers: string[],
  unit: { unitId: string; soldToCustomerNumber: string },
): Prisma.PriceConditionWhereInput {
  return {
    ...key,
    materialNumber: { in: materialNumbers },
    isActive: true,
    OR: [
      { scope: PriceConditionScope.B2B_UNIT, unitId: unit.unitId },
      {
        scope: PriceConditionScope.SOLD_TO,
        soldToCustomerNumber: unit.soldToCustomerNumber,
      },
      { scope: PriceConditionScope.SALES_AREA },
    ],
  };
}

export function noPriceText(
  materialNumber: string,
  key: SalesAreaKey,
  pricingDate: string,
) {
  return `No price found for material ${materialNumber} in sales area ${formatSalesArea(key)} on ${pricingDate}`;
}

function toCandidate(
  condition: PriceCondition & { conditionType: ConditionType },
): ConditionCandidate {
  return {
    conditionId: condition.conditionId,
    scope: condition.scope,
    salesArea: salesAreaKeyOf(condition),
    amount: condition.amount,
    currency: condition.currency,
    validFrom: fromDbDate(condition.validFrom),
    validTo: condition.validTo && fromDbDate(condition.validTo),
    isActive: condition.isActive,
    conditionType: toConditionTypeSummary(condition.conditionType),
  };
}

/** Steps with amounts as decimal strings in the decimal places of the currency */
export function toResultSteps(
  steps: PricingStep[],
  currency: CurrencyPrecision,
): PriceResultStep[] {
  return steps.map((step) => ({
    source: step.source,
    conditionId: step.conditionId,
    amount: step.amount && formatInCurrency(step.amount, currency),
    applied: step.applied,
    conditionType: step.conditionType,
  }));
}
