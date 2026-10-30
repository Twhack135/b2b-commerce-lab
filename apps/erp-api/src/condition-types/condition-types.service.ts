import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_SEQUENCE as SCOPE_ORDER } from '../pricing/price-determination';
import { ConditionType } from './condition-type.interface';
import {
  conditionRecordRestriction,
  toConditionTypeSummary,
} from './condition-type-rules';

@Injectable()
export class ConditionTypesService {
  constructor(private readonly prisma: PrismaService) {}

  /** All condition types, also inactive and not yet supported ones */
  async findAll(): Promise<ConditionType[]> {
    const types = await this.prisma.conditionType.findMany({
      include: { allowedScopes: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return types.map((type) => {
      const restriction = conditionRecordRestriction(type);
      return {
        ...toConditionTypeSummary(type),
        isActive: type.isActive,
        sortOrder: type.sortOrder,
        allowedForConditionRecords: type.allowedForConditionRecords,
        usableForPriceConditions: restriction === null,
        restriction,
        allowedScopes: SCOPE_ORDER.filter((scope) =>
          type.allowedScopes.some((s) => s.scope === scope),
        ),
      };
    });
  }
}
