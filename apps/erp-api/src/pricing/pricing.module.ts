import { Module } from '@nestjs/common';
import { PricingProceduresModule } from '../pricing-procedures/pricing-procedures.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentPricingService } from './document-pricing.service';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({
  imports: [PrismaModule, PricingProceduresModule],
  controllers: [PricingController],
  providers: [PricingService, DocumentPricingService],
  // Used by the order simulation to price several positions at once
  exports: [PricingService],
})
export class PricingModule {}
