import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { fromDbDate } from '../common/dates';
import { formatAmount } from '../common/money';
import { PriceConditionScope } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { determinePrice } from './price-determination';
import { PriceResult } from './price-result.interface';

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
    });

    const quantity = dto.quantity ?? 1;
    const result = determinePrice({
      pricingDate: dto.pricingDate,
      quantity,
      basePrice: material.price,
      currency: material.currency,
      candidates: conditions.map((c) => ({
        conditionId: c.conditionId,
        scope: c.scope,
        amount: c.amount,
        currency: c.currency,
        validFrom: fromDbDate(c.validFrom),
        validTo: c.validTo && fromDbDate(c.validTo),
        isActive: c.isActive,
      })),
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
      conditionId: result.condition?.conditionId ?? null,
      validFrom: result.condition?.validFrom ?? null,
      validTo: result.condition?.validTo ?? null,
      steps: result.steps.map((step) => ({
        source: step.source,
        conditionId: step.conditionId,
        amount: step.amount && formatAmount(step.amount),
        applied: step.applied,
      })),
    };
  }
}
