import { Controller, Get, Param } from '@nestjs/common';
import {
  PricingProcedureDetail,
  PricingProcedureSummary,
} from './pricing-procedure.interface';
import { PricingProceduresService } from './pricing-procedures.service';

/** Pricing procedures, read-only (configuration through migrations) */
@Controller('pricing-procedures')
export class PricingProceduresController {
  constructor(private readonly service: PricingProceduresService) {}

  @Get()
  findAll(): Promise<PricingProcedureSummary[]> {
    return this.service.findAll();
  }

  @Get(':code')
  findOne(@Param('code') code: string): Promise<PricingProcedureDetail> {
    return this.service.findOne(code);
  }
}
