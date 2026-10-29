import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConditionTypesController } from './condition-types.controller';
import { ConditionTypesService } from './condition-types.service';

@Module({
  imports: [PrismaModule],
  controllers: [ConditionTypesController],
  providers: [ConditionTypesService],
})
export class ConditionTypesModule {}
