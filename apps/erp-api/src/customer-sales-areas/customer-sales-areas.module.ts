import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomerSalesAreasController } from './customer-sales-areas.controller';
import { CustomerSalesAreasService } from './customer-sales-areas.service';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerSalesAreasController],
  providers: [CustomerSalesAreasService],
})
export class CustomerSalesAreasModule {}
