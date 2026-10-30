import { Module } from '@nestjs/common';
import { Clock } from '../common/clock';
import { PricingModule } from '../pricing/pricing.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';

@Module({
  imports: [PrismaModule, PricingModule],
  controllers: [SalesOrdersController],
  providers: [SalesOrdersService, Clock],
})
export class SalesOrdersModule {}
