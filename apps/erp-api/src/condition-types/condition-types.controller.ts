import { Controller, Get } from '@nestjs/common';
import { ConditionType } from './condition-type.interface';
import { ConditionTypesService } from './condition-types.service';

// Read-only for now: condition types are configuration from the migration.
// Administration (create, rename, deactivate) needs its own rules later.
@Controller('condition-types')
export class ConditionTypesController {
  constructor(private readonly conditionTypesService: ConditionTypesService) {}

  @Get()
  findAll(): Promise<ConditionType[]> {
    return this.conditionTypesService.findAll();
  }
}
