import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PricingProceduresController } from './pricing-procedures.controller';
import { PricingProceduresService } from './pricing-procedures.service';

/**
 * Pricing procedures and access sequences (Sprint 13A): read-only admin
 * API, and the procedure determination for the pricing calculation.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PricingProceduresController],
  providers: [PricingProceduresService],
  exports: [PricingProceduresService],
})
export class PricingProceduresModule {}
