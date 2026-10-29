import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { PriceResult } from './price-result.interface';
import { PricingService } from './pricing.service';

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  // POST with a body, because the backoffice proxy forwards no query
  // strings. Nothing is stored, so the answer is 200 instead of 201.
  @Post('price')
  @HttpCode(200)
  calculate(@Body() dto: CalculatePriceDto): Promise<PriceResult> {
    return this.pricingService.calculate(dto);
  }
}
