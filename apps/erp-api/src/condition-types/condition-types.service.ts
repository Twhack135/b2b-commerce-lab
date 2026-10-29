import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
      };
    });
  }
}
