import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CalculateDocumentDto } from './dto/calculate-document.dto';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { DocumentPricingResult } from './document-pricing.interface';
import { DocumentPricingService } from './document-pricing.service';
import { PriceResult } from './price-result.interface';
import { PricingService } from './pricing.service';

@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricingService: PricingService,
    private readonly documentPricing: DocumentPricingService,
  ) {}

  // POST with a body, because the backoffice proxy forwards no query
  // strings. Nothing is stored, so the answer is 200 instead of 201.
  @Post('price')
  @HttpCode(200)
  calculate(@Body() dto: CalculatePriceDto): Promise<PriceResult> {
    return this.pricingService.calculate(dto);
  }

  /**
   * A whole document with the pricing procedure of its sales area (Sprint
   * 13A). Runs next to POST /pricing/price and the order simulation, which
   * stay unchanged. 200 also when a mandatory price is missing: the status
   * is then INCOMPLETE, with a message per item.
   */
  @Post('calculate')
  @HttpCode(200)
  calculateDocument(
    @Body() dto: CalculateDocumentDto,
  ): Promise<DocumentPricingResult> {
    return this.documentPricing.calculate(dto);
  }
}
