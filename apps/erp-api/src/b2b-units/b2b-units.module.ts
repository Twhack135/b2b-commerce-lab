import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { B2bUnitsController } from './b2b-units.controller';
import { B2bUnitsService } from './b2b-units.service';

@Module({
  imports: [PrismaModule],
  controllers: [B2bUnitsController],
  providers: [B2bUnitsService],
})
export class B2bUnitsModule {}
