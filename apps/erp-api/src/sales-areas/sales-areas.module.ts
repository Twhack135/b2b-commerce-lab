import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SalesAreasController } from './sales-areas.controller';
import { SalesAreasService } from './sales-areas.service';

@Module({
  imports: [PrismaModule],
  controllers: [SalesAreasController],
  providers: [SalesAreasService],
})
export class SalesAreasModule {}
