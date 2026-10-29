import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({
  imports: [PrismaModule],
  controllers: [PricingController],
  providers: [PricingService],
  // Used by the order simulation to price several positions at once
  exports: [PricingService],
})
export class PricingModule {}
